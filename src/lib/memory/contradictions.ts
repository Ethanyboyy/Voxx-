import { db } from "@/lib/db";
import { getMemory, listMemories } from "@/lib/memory/service";
import { rankBySimilarity } from "@/lib/memory/embeddings";
import { createProposal } from "@/lib/cognition/proposals";
import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/types";

const SIMILARITY_THRESHOLD = 0.6;
const MAX_CANDIDATES = 3;

export interface ContradictionCheckResult {
  contradicts: boolean;
  explanation: string;
}

/** Pulled out as a pure function so it's testable without a real/mock model round-trip. */
export function parseContradictionResponse(text: string): ContradictionCheckResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.contradicts !== "boolean") return null;
    return {
      contradicts: parsed.contradicts,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    };
  } catch {
    return null;
  }
}

const CONTRADICTION_SYSTEM_PROMPT = `You compare two personal memory statements and decide whether they factually contradict each other (not just relate to the same topic). Respond with ONLY a JSON object, no other text: {"contradicts": boolean, "explanation": string}. If they are about different things, or one is simply more specific than the other, contradicts is false.`;

/**
 * On-demand contradiction detection (same posture as detectPatterns() —
 * triggered, not a hidden background job). Finds semantically similar
 * existing memories, asks the configured AIProvider whether they actually
 * conflict, and — only if so — creates a Proposal. It never writes a
 * MemoryRelation directly: a human approves before VOX records a
 * contradiction as fact.
 */
export async function checkForContradictions(
  userId: string,
  memoryId: string,
  options?: { aiProvider?: AIProvider }
) {
  const memory = await getMemory(userId, memoryId);
  if (!memory) return [];

  const others = (await listMemories(userId)).filter((m) => m.id !== memoryId);
  const ranked = await rankBySimilarity(
    memory.content,
    others.map((m) => ({ id: m.id, content: m.content }))
  );
  const candidates = ranked.filter((r) => r.similarity >= SIMILARITY_THRESHOLD).slice(0, MAX_CANDIDATES);
  const provider = options?.aiProvider ?? getAIProvider();

  const proposals = [];
  for (const candidate of candidates) {
    const other = others.find((m) => m.id === candidate.id);
    if (!other) continue;

    const existingRelation = await db.memoryRelation.findFirst({
      where: {
        userId,
        OR: [
          { fromMemoryId: memoryId, toMemoryId: other.id },
          { fromMemoryId: other.id, toMemoryId: memoryId },
        ],
      },
    });
    if (existingRelation) continue;

    const response = await provider.generate({
      system: CONTRADICTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Memory A: ${memory.content}\nMemory B: ${other.content}` }],
      maxTokens: 200,
    });
    const parsed = parseContradictionResponse(response.content);
    if (!parsed?.contradicts) continue;

    const proposal = await createProposal({
      userId,
      observation: `New or updated memory: "${memory.content}"`,
      connection: `Semantically similar to an existing memory (similarity ${candidate.similarity.toFixed(2)}): "${other.content}"`,
      implication: parsed.explanation || "These two memories may contradict each other.",
      suggestedAction: "Mark these memories as contradicting so you can resolve which one is current.",
      actionType: "memory.create_relation",
      actionPayload: {
        fromMemoryId: memory.id,
        toMemoryId: other.id,
        type: "CONTRADICTS",
        note: parsed.explanation,
      },
      capability: "memory.contradiction_resolution",
      requiredLevel: "RECOMMEND",
      confidence: "LOW",
      evidence: { memoryIds: [memory.id, other.id] },
    });
    proposals.push(proposal);
  }

  return proposals;
}
