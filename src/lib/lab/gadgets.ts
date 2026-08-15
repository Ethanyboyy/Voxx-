import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence, LabDesignStatus } from "@/generated/prisma/enums";

export interface GadgetStatsInput {
  massKg: number;
  powerRequirementW: number;
  batteryLifeHours: number;
  durability: number;
  sensorAccuracy: number;
  rangeM: number;
  manufacturingComplexity: number;
  estimatedCostUsd: number;
  reliability: number;
  confidence?: LabConfidence;
}

export interface CreateGadgetInput {
  userId: string;
  projectId?: string;
  name: string;
  category: string;
  description?: string;
  status?: LabDesignStatus;
  stats: GadgetStatsInput;
  versionLabel?: string;
}

export async function createGadget(input: CreateGadgetInput) {
  const gadget = await db.labGadget.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      category: input.category,
      description: input.description,
      status: input.status ?? "ACTIVE",
    },
  });

  const version = await db.labGadgetVersion.create({
    data: {
      gadgetId: gadget.id,
      label: input.versionLabel ?? "v0.1",
      stats: { create: input.stats },
    },
  });

  const updated = await db.labGadget.update({
    where: { id: gadget.id },
    data: { currentVersionId: version.id },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.gadget.created",
    payload: { name: gadget.name },
    subjectType: "LabGadget",
    subjectId: gadget.id,
  });

  return updated;
}

export async function listGadgets(userId: string, filters?: { status?: LabDesignStatus; projectId?: string }) {
  return db.labGadget.findMany({
    where: { userId, status: filters?.status, projectId: filters?.projectId },
    include: { currentVersion: { include: { stats: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getGadget(userId: string, id: string) {
  return db.labGadget.findFirst({
    where: { id, userId },
    include: {
      currentVersion: { include: { stats: true } },
      versions: { include: { stats: true }, orderBy: { createdAt: "asc" } },
      components: true,
      project: true,
    },
  });
}

export interface UpdateGadgetInput {
  name?: string;
  category?: string;
  description?: string;
  status?: LabDesignStatus;
  projectId?: string | null;
}

export async function updateGadget(userId: string, id: string, updates: UpdateGadgetInput) {
  const existing = await db.labGadget.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.labGadget.update({ where: { id }, data: updates });
}

export interface CreateGadgetVersionInput {
  label: string;
  note?: string;
  stats: GadgetStatsInput;
  makeCurrent?: boolean;
}

export async function createGadgetVersion(userId: string, gadgetId: string, input: CreateGadgetVersionInput) {
  const gadget = await db.labGadget.findFirst({ where: { id: gadgetId, userId } });
  if (!gadget) return null;

  const version = await db.labGadgetVersion.create({
    data: { gadgetId, label: input.label, note: input.note, stats: { create: input.stats } },
    include: { stats: true },
  });

  if (input.makeCurrent ?? true) {
    await db.labGadget.update({ where: { id: gadgetId }, data: { currentVersionId: version.id } });
  }

  await recordEvent({
    userId,
    type: "lab.gadget.variant_created",
    payload: { name: gadget.name, label: input.label },
    subjectType: "LabGadget",
    subjectId: gadgetId,
  });

  return version;
}
