import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { listMemories } from "@/lib/memory/service";
import type { ChatMessageInput } from "@/lib/ai/types";
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
  createdAt: Date;
}

function toMessageDTO(row: Message): MessageDTO {
  return {
    id: row.id,
    role: row.role,
    content: decryptField(row.content),
    model: row.model,
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
- The "known context" below comes from VOX's memory system. Each item has a confidence level; treat LOW-confidence items as tentative.`;

export async function buildSystemPrompt(userId: string): Promise<string> {
  const memories = await listMemories(userId);
  const recent = memories.slice(0, 12);

  if (recent.length === 0) {
    return `${SYSTEM_PROMPT_HEADER}\n\nKnown context: none yet — this is early in getting to know the user.`;
  }

  const lines = recent.map((m) => `- [${m.category}, ${m.confidence}] ${m.content}`);
  return `${SYSTEM_PROMPT_HEADER}\n\nKnown context about the user:\n${lines.join("\n")}`;
}

export function toProviderMessages(messages: MessageDTO[]): ChatMessageInput[] {
  return messages
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));
}
