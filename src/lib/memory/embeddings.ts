import { db } from "@/lib/db";
import { getEmbeddingProvider, cosineSimilarity } from "@/lib/embeddings";
import { logger } from "@/lib/observability/logger";

/**
 * Returns the vector for a memory, computing and caching it if missing or if
 * the active embedding provider has changed since it was last computed.
 * Backfill for pre-Phase-2 memories happens exactly this way — lazily, on
 * first semantic search that touches them — rather than a blocking migration.
 */
export async function ensureMemoryEmbedding(memoryId: string, plaintextContent: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const existing = await db.memoryEmbedding.findUnique({ where: { memoryId } });
  if (existing && existing.provider === provider.id) {
    return JSON.parse(existing.vector) as number[];
  }

  return recomputeMemoryEmbedding(memoryId, plaintextContent);
}

/**
 * Always recomputes, regardless of whether a current-provider vector already
 * exists — for when the caller knows the content changed (updateMemory) and
 * a cached vector would now be stale.
 */
export async function recomputeMemoryEmbedding(memoryId: string, plaintextContent: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const vector = await provider.embed(plaintextContent);
  await db.memoryEmbedding.upsert({
    where: { memoryId },
    create: {
      memoryId,
      provider: provider.id,
      dimensions: provider.dimensions,
      vector: JSON.stringify(vector),
    },
    update: {
      provider: provider.id,
      dimensions: provider.dimensions,
      vector: JSON.stringify(vector),
    },
  });
  return vector;
}

/** Best-effort embed: logs and swallows failures rather than blocking memory writes. */
export async function ensureMemoryEmbeddingSafe(memoryId: string, plaintextContent: string): Promise<void> {
  try {
    await ensureMemoryEmbedding(memoryId, plaintextContent);
  } catch (error) {
    logger.warn("memory.embedding_failed", {
      memoryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Best-effort forced recompute — see recomputeMemoryEmbedding(). */
export async function recomputeMemoryEmbeddingSafe(memoryId: string, plaintextContent: string): Promise<void> {
  try {
    await recomputeMemoryEmbedding(memoryId, plaintextContent);
  } catch (error) {
    logger.warn("memory.embedding_failed", {
      memoryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface RankedId {
  id: string;
  similarity: number;
}

/**
 * Ranks candidate memories (id + plaintext content, already decrypted by the
 * caller) by cosine similarity to queryText. Embeds anything missing a
 * current-provider vector along the way.
 */
export async function rankBySimilarity(
  queryText: string,
  candidates: { id: string; content: string }[]
): Promise<RankedId[]> {
  const provider = getEmbeddingProvider();
  const queryVector = await provider.embed(queryText);

  const ranked: RankedId[] = [];
  for (const candidate of candidates) {
    const vector = await ensureMemoryEmbedding(candidate.id, candidate.content);
    ranked.push({ id: candidate.id, similarity: cosineSimilarity(queryVector, vector) });
  }
  return ranked.sort((a, b) => b.similarity - a.similarity);
}
