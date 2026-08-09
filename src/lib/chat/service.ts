import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { getSemanticMemories, listMemories } from "@/lib/memory/service";
import type { ChatMessageInput } from "@/lib/ai/types";
import type { Confidence } from "@/generated/prisma/enums";
import type { Message } from "@/generated/prisma/client";

export async function createConversation(userId: string, title?: string, projectId?: string) {
  return db.conversation.create({
    data: { userId, title: title?.trim() || "New conversation", projectId },
  });
}

export async function listConversations(userId: string) {
  return db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

export interface MessageDTO {
  id: string;
  role: Message["role"];
  content: string;
  model: string | null;
  meta: string | null;
  createdAt: Date;
}

function toMessageDTO(row: Message): MessageDTO {
  return {
    id: row.id,
    role: row.role,
    content: decryptField(row.content),
    model: row.model,
    meta: row.meta,
    createdAt: row.createdAt,
  };
}

export async function getConversation(userId: string, id: string) {
  const conversation = await db.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return null;
  return { ...conversation, messages: conversation.messages.map(toMessageDTO) };
}

export async function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  extra?: { model?: string; inputTokens?: number; outputTokens?: number; meta?: Record<string, unknown> }
) {
  const [row] = await db.$transaction([
    db.message.create({
      data: {
        conversationId,
        role,
        content: encryptField(content),
        model: extra?.model,
        inputTokens: extra?.inputTokens,
        outputTokens: extra?.outputTokens,
        meta: extra?.meta ? JSON.stringify(extra.meta) : undefined,
      },
    }),
    db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
  return toMessageDTO(row);
}

const SYSTEM_PROMPT_HEADER = `You are VOX, the user's personal, private cognitive operating system — not a generic assistant persona.

Ground rules:
- Be direct, concise, and honest. Never claim certainty you don't have.
- If you are inferring rather than recalling a stated fact, say so explicitly (e.g. "I'd guess..." / "based on what you've told me...").
- You have not performed any research or browsed the web unless a research result is explicitly included in this context — never claim you looked something up if it isn't provided.
- The "known context" below comes from VOX's memory system, ranked by relevance to what the user just said. Each item has a confidence level; treat LOW-confidence items as tentative.`;

/**
 * What actually fed a given response — the data backing the Context
 * Inspector UI. Populated here (not reconstructed after the fact) because
 * this is the one place that knows exactly which memories were selected and
 * why. See PHASE_2_ARCHITECTURE.md §6.
 */
export interface ContextTrace {
  memoriesUsed: { id: string; content: string; confidence: Confidence; similarity: number }[];
  assumptions: string[];
}

function snippet(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface SystemPromptResult {
  prompt: string;
  trace: ContextTrace;
}

/**
 * Builds the system prompt for a chat turn using semantic memory retrieval
 * (src/lib/memory/service.ts#getSemanticMemories) instead of recency
 * ordering, plus any CONFIRMED-confidence facts not already surfaced by
 * similarity — durable facts shouldn't get crowded out by whatever's
 * topically similar right now.
 */
export async function buildSystemPrompt(userId: string, query: string): Promise<SystemPromptResult> {
  const semantic = query.trim() ? await getSemanticMemories(userId, query, 8) : [];
  const includedIds = new Set(semantic.map((m) => m.id));

  const confirmed = (await listMemories(userId, { confidence: "CONFIRMED" }))
    .filter((m) => !includedIds.has(m.id))
    .slice(0, 4)
    .map((m) => ({ ...m, similarity: 0 }));

  const selected = [...semantic, ...confirmed];

  if (selected.length === 0) {
    return {
      prompt: `${SYSTEM_PROMPT_HEADER}\n\nKnown context: none yet — this is early in getting to know the user.`,
      trace: { memoriesUsed: [], assumptions: [] },
    };
  }

  const lines = selected.map((m) => `- [${m.category}, ${m.confidence}] ${m.content}`);
  return {
    prompt: `${SYSTEM_PROMPT_HEADER}\n\nKnown context about the user:\n${lines.join("\n")}`,
    trace: {
      memoriesUsed: selected.map((m) => ({
        id: m.id,
        content: snippet(m.content),
        confidence: m.confidence,
        similarity: m.similarity,
      })),
      assumptions: [],
    },
  };
}

export function toProviderMessages(messages: MessageDTO[]): ChatMessageInput[] {
  return messages
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));
}
