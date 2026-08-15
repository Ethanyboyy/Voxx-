import { db } from "@/lib/db";
import type { LabProjectStatus } from "@/generated/prisma/enums";

export interface CreateLabProjectInput {
  userId: string;
  name: string;
  description?: string;
  status?: LabProjectStatus;
}

export async function createLabProject(input: CreateLabProjectInput) {
  return db.labProject.create({
    data: {
      userId: input.userId,
      name: input.name,
      description: input.description,
      status: input.status ?? "ACTIVE",
    },
  });
}

export async function listLabProjects(userId: string) {
  return db.labProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { suits: true, gadgets: true, webProfiles: true, simulations: true, experiments: true } },
    },
  });
}

export async function getLabProject(userId: string, id: string) {
  return db.labProject.findFirst({
    where: { id, userId },
    include: {
      suits: { orderBy: { updatedAt: "desc" } },
      gadgets: { orderBy: { updatedAt: "desc" } },
      webProfiles: { orderBy: { updatedAt: "desc" } },
      simulations: { orderBy: { updatedAt: "desc" } },
      experiments: { orderBy: { updatedAt: "desc" } },
    },
  });
}

export interface UpdateLabProjectInput {
  name?: string;
  description?: string;
  status?: LabProjectStatus;
}

export async function updateLabProject(userId: string, id: string, updates: UpdateLabProjectInput) {
  const existing = await db.labProject.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.labProject.update({ where: { id }, data: updates });
}

export async function deleteLabProject(userId: string, id: string) {
  const existing = await db.labProject.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.labProject.delete({ where: { id } });
  return true;
}
