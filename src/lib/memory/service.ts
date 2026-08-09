import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { recordEvent } from "@/lib/observability/events";
import type { Confidence, MemoryCategory, MemorySourceType } from "@/generated/prisma/enums";
import type { Memory, MemorySource } from "@/generated/prisma/client";

export interface MemoryDTO {
  id: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence: Confidence;
  provenance: string | null;
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
    payload: { memoryId: row.id, category: row.category, confidence: row.confidence },
  });

  return toDTO(row);
}

export interface ListMemoriesFilter {
  category?: MemoryCategory;
  confidence?: Confidence;
  search?: string;
}

export async function listMemories(userId: string, filter: ListMemoriesFilter = {}): Promise<MemoryDTO[]> {
  const rows = await db.memory.findMany({
    where: {
      userId,
      category: filter.category,
      confidence: filter.confidence,
    },
    include: { source: true },
    orderBy: { createdAt: "desc" },
  });

  const dtos = rows.map(toDTO);
  if (!filter.search) return dtos;

  const needle = filter.search.toLowerCase();
  return dtos.filter((m) => m.content.toLowerCase().includes(needle));
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
    payload: { memoryId: id, fields: Object.keys(updates) },
  });

  return toDTO(row);
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const existing = await db.memory.findFirst({ where: { id, userId } });
  if (!existing) return false;

  await db.memory.delete({ where: { id } });
  await recordEvent({ userId, type: "memory.deleted", payload: { memoryId: id } });
  return true;
}

/** Full plaintext export for the user's own data-portability request. */
export async function exportMemories(userId: string): Promise<MemoryDTO[]> {
  const memories = await listMemories(userId);
  await recordEvent({ userId, type: "memory.exported", payload: { count: memories.length } });
  return memories;
}
