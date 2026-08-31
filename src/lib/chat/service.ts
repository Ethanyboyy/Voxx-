import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { getSemanticMemories, listMemories } from "@/lib/memory/service";
import { getActiveObjective, getNextBestAction } from "@/lib/objectives/service";
import { getCrossDomainSnapshot, summarizeCrossDomainSnapshot } from "@/lib/orchestrator/service";
import { logger } from "@/lib/observability/logger";
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

/**
 * A single undecryptable row (e.g. content written under an encryption key
 * that's since rotated) must not take down the whole conversation — every
 * other message in it is still readable and the user still needs to chat.
 */
function decryptMessageContent(row: Message): string {
  try {
    return decryptField(row.content);
  } catch (error) {
    logger.error("chat.message_decrypt_failed", {
      messageId: row.id,
      conversationId: row.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "[This message could not be decrypted.]";
  }
}

function toMessageDTO(row: Message): MessageDTO {
  return {
    id: row.id,
    role: row.role,
    content: decryptMessageContent(row),
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

/**
 * Rewrites one assistant message in place.
 *
 * The one legitimate mutation of a message, and it exists for a specific
 * shape: an orchestrated turn persists its message the moment the run starts,
 * so a reload mid-run finds the conversation intact, and then rewrites it with
 * the real outcome once the run settles. The alternative — appending a second
 * assistant message — would leave the conversation permanently showing a
 * "working on it" that never resolved.
 *
 * Scoped by conversation as well as id so a message can only be rewritten
 * within the conversation the caller already proved it owns.
 */
export async function updateAssistantMessage(
  conversationId: string,
  messageId: string,
  content: string,
  meta?: Record<string, unknown>,
) {
  const existing = await db.message.findFirst({ where: { id: messageId, conversationId, role: "ASSISTANT" } });
  if (!existing) return null;

  const row = await db.message.update({
    where: { id: existing.id },
    data: { content: encryptField(content), ...(meta ? { meta: JSON.stringify(meta) } : {}) },
  });
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
  const [semantic, activeObjective, nextBestAction, crossDomainSnapshot] = await Promise.all([
    query.trim() ? getSemanticMemories(userId, query, 8) : Promise.resolve([]),
    getActiveObjective(userId),
    getNextBestAction(userId),
    getCrossDomainSnapshot(userId),
  ]);
  const snapshotSection = summarizeCrossDomainSnapshot(crossDomainSnapshot);
  const includedIds = new Set(semantic.map((m) => m.id));

  const confirmed = (await listMemories(userId, { confidence: "CONFIRMED" }))
    .filter((m) => !includedIds.has(m.id))
    .slice(0, 4)
    .map((m) => ({ ...m, similarity: 0 }));

  const selected = [...semantic, ...confirmed];

  const objectiveSection = activeObjective
    ? `\n\nActive objective: "${activeObjective.title}"${activeObjective.description ? ` — ${activeObjective.description}` : ""}. ${
        activeObjective.strategy ? `Strategy so far: ${activeObjective.strategy}. ` : "No strategy has been recorded yet. "
      }${
        activeObjective.targetValue != null
          ? `Progress: ${activeObjective.currentValue ?? 0} / ${activeObjective.targetValue} ${activeObjective.targetUnit ?? ""}. `
          : ""
      }${
        nextBestAction?.action
          ? `Current top next action: ${nextBestAction.action}.`
          : "No next action has been set yet — help identify a concrete one instead of assuming progress."
      } Never claim progress on this objective, revenue earned, or work done that isn't backed by what's actually recorded.`
    : "";

  if (selected.length === 0) {
    return {
      prompt: `${SYSTEM_PROMPT_HEADER}\n\nKnown context: none yet — this is early in getting to know the user.${objectiveSection}${snapshotSection}`,
      trace: { memoriesUsed: [], assumptions: [] },
    };
  }

  const lines = selected.map((m) => `- [${m.category}, ${m.confidence}] ${m.content}`);
  return {
    prompt: `${SYSTEM_PROMPT_HEADER}\n\nKnown context about the user:\n${lines.join("\n")}${objectiveSection}${snapshotSection}`,
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
