import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { MemoryRelationType } from "@/generated/prisma/enums";

export interface CreateMemoryRelationInput {
  userId: string;
  fromMemoryId: string;
  toMemoryId: string;
  type: MemoryRelationType;
  note?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED";
}

export async function createMemoryRelation(input: CreateMemoryRelationInput) {
  const [from, to] = await Promise.all([
    db.memory.findFirst({ where: { id: input.fromMemoryId, userId: input.userId } }),
    db.memory.findFirst({ where: { id: input.toMemoryId, userId: input.userId } }),
  ]);
  if (!from || !to) return null;

  const relation = await db.memoryRelation.create({
    data: {
      userId: input.userId,
      fromMemoryId: input.fromMemoryId,
      toMemoryId: input.toMemoryId,
      type: input.type,
      note: input.note,
      confidence: input.confidence ?? "LOW",
    },
  });

  if (input.type === "SUPERSEDES") {
    await db.memory.update({ where: { id: input.toMemoryId }, data: { supersededAt: new Date() } });
    await recordEvent({
      userId: input.userId,
      type: "memory.superseded",
      subjectType: "Memory",
      subjectId: input.toMemoryId,
      payload: { supersededBy: input.fromMemoryId },
    });
  } else {
    await recordEvent({
      userId: input.userId,
      type: "memory.relation_created",
      subjectType: "Memory",
      subjectId: input.fromMemoryId,
      payload: { relationType: input.type, toMemoryId: input.toMemoryId },
    });
  }

  return relation;
}

export async function listMemoryRelations(userId: string, memoryId: string) {
  return db.memoryRelation.findMany({
    where: { userId, OR: [{ fromMemoryId: memoryId }, { toMemoryId: memoryId }] },
    orderBy: { createdAt: "desc" },
  });
}

/** Convenience wrapper: newMemoryId supersedes oldMemoryId. */
export async function supersedeMemory(userId: string, newMemoryId: string, oldMemoryId: string, note?: string) {
  return createMemoryRelation({
    userId,
    fromMemoryId: newMemoryId,
    toMemoryId: oldMemoryId,
    type: "SUPERSEDES",
    note,
    confidence: "HIGH",
  });
}
