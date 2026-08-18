import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence, LabResearchCategory } from "@/generated/prisma/enums";

export interface CreateResearchItemInput {
  userId: string;
  projectId?: string;
  title: string;
  category: LabResearchCategory;
  source?: string;
  sourceDate?: string;
  confidence?: LabConfidence;
  relevance?: number;
  notes?: string;
  /// Optional: the specific component this finding informs.
  componentId?: string;
}

export async function createResearchItem(input: CreateResearchItemInput) {
  const item = await db.labResearchItem.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      category: input.category,
      source: input.source,
      sourceDate: input.sourceDate ? new Date(input.sourceDate) : undefined,
      confidence: input.confidence ?? "ESTIMATED",
      relevance: input.relevance ?? 50,
      notes: input.notes,
      componentId: input.componentId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.research.recorded",
    payload: { title: item.title, category: item.category },
    subjectType: "LabResearchItem",
    subjectId: item.id,
  });

  return item;
}

export async function listResearchItems(userId: string, category?: LabResearchCategory) {
  return db.labResearchItem.findMany({
    where: { userId, category },
    include: { project: true },
    orderBy: [{ relevance: "desc" }, { updatedAt: "desc" }],
  });
}

export async function getResearchItem(userId: string, id: string) {
  return db.labResearchItem.findFirst({ where: { id, userId }, include: { project: true } });
}

export interface UpdateResearchItemInput {
  title?: string;
  category?: LabResearchCategory;
  source?: string;
  sourceDate?: string;
  confidence?: LabConfidence;
  relevance?: number;
  notes?: string;
  componentId?: string | null;
}

export async function updateResearchItem(userId: string, id: string, updates: UpdateResearchItemInput) {
  const existing = await db.labResearchItem.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.labResearchItem.update({
    where: { id },
    data: {
      ...updates,
      sourceDate: updates.sourceDate ? new Date(updates.sourceDate) : undefined,
    },
  });
}

export async function deleteResearchItem(userId: string, id: string) {
  const existing = await db.labResearchItem.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.labResearchItem.delete({ where: { id } });
  return true;
}
