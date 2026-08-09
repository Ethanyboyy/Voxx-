import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { recordEvent } from "@/lib/observability/events";
import { ensureMemoryEmbeddingSafe, rankBySimilarity, recomputeMemoryEmbeddingSafe } from "@/lib/memory/embeddings";
import type { Confidence, MemoryCategory, MemorySourceType } from "@/generated/prisma/enums";
import type { Memory, MemorySource } from "@/generated/prisma/client";

export interface MemoryDTO {
  id: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence: Confidence;
  provenance: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  source: MemorySourceDTO | null;
}

export interface MemorySourceDTO {
  type: MemorySourceType;
  reference: string | null;
  messageId: string | null;
  researchItemId: string | null;
}

function toDTO(row: Memory & { source: MemorySource | null }): MemoryDTO {
  return {
    id: row.id,
    userId: row.userId,
    content: decryptField(row.content),
    category: row.category,
    confidence: row.confidence,
    provenance: row.provenance,
    supersededAt: row.supersededAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: row.source
      ? {
          type: row.source.type,
          reference: row.source.reference,
          messageId: row.source.messageId,
          researchItemId: row.source.researchItemId,
        }
      : null,
  };
}

export interface CreateMemoryInput {
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence?: Confidence;
  provenance?: string;
  source?: {
    type: MemorySourceType;
    reference?: string;
    messageId?: string;
    researchItemId?: string;
  };
}

export async function createMemory(input: CreateMemoryInput): Promise<MemoryDTO> {
  const row = await db.memory.create({
    data: {
      userId: input.userId,
      content: encryptField(input.content),
      category: input.category,
      confidence: input.confidence ?? "MEDIUM",
      provenance: input.provenance,
      source: input.source
        ? {
            create: {
              type: input.source.type,
              reference: input.source.reference,
              messageId: input.source.messageId,
              researchItemId: input.source.researchItemId,
            },
          }
        : undefined,
    },
    include: { source: true },
  });

  await recordEvent({
    userId: input.userId,
    type: "memory.created",
    subjectType: "Memory",
    subjectId: row.id,
    payload: { memoryId: row.id, category: row.category, confidence: row.confidence },
  });

  await ensureMemoryEmbeddingSafe(row.id, input.content);

  return toDTO(row);
}

export interface ListMemoriesFilter {
  category?: MemoryCategory;
  confidence?: Confidence;
  search?: string;
  /** Superseded memories are excluded by default — still inspectable/exportable via this flag. */
  includeSuperseded?: boolean;
}

export async function listMemories(userId: string, filter: ListMemoriesFilter = {}): Promise<MemoryDTO[]> {
  const rows = await db.memory.findMany({
    where: {
      userId,
      category: filter.category,
      confidence: filter.confidence,
      supersededAt: filter.includeSuperseded ? undefined : null,
    },
    include: { source: true },
    orderBy: { createdAt: "desc" },
  });

  const dtos = rows.map(toDTO);
  if (!filter.search) return dtos;

  const needle = filter.search.toLowerCase();
  return dtos.filter((m) => m.content.toLowerCase().includes(needle));
}

/**
 * Ranks active memories by semantic similarity to queryText (see
 * src/lib/embeddings/ and src/lib/memory/embeddings.ts). This is what chat
 * context assembly uses instead of recency-only ordering.
 */
export async function getSemanticMemories(
  userId: string,
  queryText: string,
  limit = 8
): Promise<(MemoryDTO & { similarity: number })[]> {
  const memories = await listMemories(userId);
  if (memories.length === 0) return [];

  const ranked = await rankBySimilarity(
    queryText,
    memories.map((m) => ({ id: m.id, content: m.content }))
  );
  const similarityById = new Map(ranked.map((r) => [r.id, r.similarity]));

  return memories
    .map((m) => ({ ...m, similarity: similarityById.get(m.id) ?? 0 }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function getMemory(userId: string, id: string): Promise<MemoryDTO | null> {
  const row = await db.memory.findFirst({ where: { id, userId }, include: { source: true } });
  return row ? toDTO(row) : null;
}

export interface UpdateMemoryInput {
  content?: string;
  category?: MemoryCategory;
  confidence?: Confidence;
  provenance?: string;
}

export async function updateMemory(
  userId: string,
  id: string,
  updates: UpdateMemoryInput
): Promise<MemoryDTO | null> {
  const existing = await db.memory.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const row = await db.memory.update({
    where: { id },
    data: {
      content: updates.content !== undefined ? encryptField(updates.content) : undefined,
      category: updates.category,
      confidence: updates.confidence,
      provenance: updates.provenance,
    },
    include: { source: true },
  });

  await recordEvent({
    userId,
    type: "memory.updated",
    subjectType: "Memory",
    subjectId: id,
    payload: { memoryId: id, fields: Object.keys(updates) },
  });

  if (updates.content !== undefined) {
    await recomputeMemoryEmbeddingSafe(id, updates.content);
  }

  return toDTO(row);
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const existing = await db.memory.findFirst({ where: { id, userId } });
  if (!existing) return false;

  await db.memory.delete({ where: { id } });
  await recordEvent({ userId, type: "memory.deleted", payload: { memoryId: id } });
  return true;
}

/** Full plaintext export for the user's own data-portability request — includes superseded memories. */
export async function exportMemories(userId: string): Promise<MemoryDTO[]> {
  const memories = await listMemories(userId, { includeSuperseded: true });
  await recordEvent({ userId, type: "memory.exported", payload: { count: memories.length } });
  return memories;
}
