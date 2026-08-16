import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type {
  LabArmorLevel,
  LabConfidence,
  LabDesignStatus,
  LabMaskLensStyle,
  LabMaterialLanguage,
  LabPatternStyle,
  LabRealityStatus,
  LabSilhouette,
} from "@/generated/prisma/enums";

export interface SuitStatsInput {
  stealth: number;
  durability: number;
  mobility: number;
  stretchiness: number;
  weightKg: number;
  thermalLoadC: number;
  protection: number;
  environmentalResistance: number;
  manufacturingComplexity: number;
  estimatedBuildHours: number;
  estimatedCostUsd: number;
  flexibility: number;
  impactResistance: number;
  visibility: number;
  noiseProfile: number;
  sensorCapacity: number;
  energyRequirementW: number;
  maintenanceComplexity: number;
  confidence?: LabConfidence;
}

export interface CreateSuitInput {
  userId: string;
  projectId?: string;
  codename: string;
  designation?: string;
  archetype: string;
  description?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  status?: LabDesignStatus;
  /// Structured design-parameter vocabulary the 3D holographic render is
  /// deterministically derived from — see LabSilhouette etc. in schema.prisma.
  silhouette?: LabSilhouette;
  materialLanguage?: LabMaterialLanguage;
  patternStyle?: LabPatternStyle;
  armorLevel?: LabArmorLevel;
  maskLensStyle?: LabMaskLensStyle;
  /// Buildability/reality axis — see LabRealityStatus in schema.prisma.
  /// Defaults to CONCEPT (most conservative) at the database level; never
  /// inferred from stats/status here.
  realityStatus?: LabRealityStatus;
  /// Path to a real .glb/.gltf asset under public/models/suits/ — see
  /// GltfSuitModel. Unset by default; the caller must point at a file that
  /// actually exists on disk, never fabricated here.
  modelUrl?: string;
  stats: SuitStatsInput;
  versionLabel?: string;
}

export async function createSuit(input: CreateSuitInput) {
  const suit = await db.labSuit.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      codename: input.codename,
      designation: input.designation ?? "MK-I",
      archetype: input.archetype,
      description: input.description,
      colorPrimary: input.colorPrimary ?? "#a855f7",
      colorSecondary: input.colorSecondary ?? "#0a0616",
      silhouette: input.silhouette,
      materialLanguage: input.materialLanguage,
      patternStyle: input.patternStyle,
      armorLevel: input.armorLevel,
      maskLensStyle: input.maskLensStyle,
      realityStatus: input.realityStatus,
      modelUrl: input.modelUrl,
      status: input.status ?? "ACTIVE",
    },
  });

  const version = await db.labSuitVersion.create({
    data: {
      suitId: suit.id,
      label: input.versionLabel ?? "v0.1",
      stats: { create: input.stats },
    },
  });

  const updated = await db.labSuit.update({
    where: { id: suit.id },
    data: { currentVersionId: version.id },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.suit.created",
    payload: { codename: suit.codename },
    subjectType: "LabSuit",
    subjectId: suit.id,
  });

  return updated;
}

export async function listSuits(userId: string, filters?: { status?: LabDesignStatus; projectId?: string }) {
  return db.labSuit.findMany({
    where: { userId, status: filters?.status, projectId: filters?.projectId },
    include: { currentVersion: { include: { stats: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getSuit(userId: string, id: string) {
  return db.labSuit.findFirst({
    where: { id, userId },
    include: {
      currentVersion: { include: { stats: true } },
      versions: { include: { stats: true }, orderBy: { createdAt: "asc" } },
      components: true,
      project: true,
    },
  });
}

export interface UpdateSuitInput {
  codename?: string;
  designation?: string;
  archetype?: string;
  description?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  silhouette?: LabSilhouette;
  materialLanguage?: LabMaterialLanguage;
  patternStyle?: LabPatternStyle;
  armorLevel?: LabArmorLevel;
  maskLensStyle?: LabMaskLensStyle;
  realityStatus?: LabRealityStatus;
  modelUrl?: string | null;
  status?: LabDesignStatus;
  projectId?: string | null;
}

export async function updateSuit(userId: string, id: string, updates: UpdateSuitInput) {
  const existing = await db.labSuit.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const suit = await db.labSuit.update({ where: { id }, data: updates });
  if (updates.status === "ARCHIVED") {
    await recordEvent({
      userId,
      type: "lab.suit.archived",
      payload: { codename: suit.codename },
      subjectType: "LabSuit",
      subjectId: suit.id,
    });
  }
  return suit;
}

export interface CreateSuitVersionInput {
  label: string;
  note?: string;
  parentVersionId?: string;
  stats: SuitStatsInput;
  makeCurrent?: boolean;
}

export async function createSuitVersion(userId: string, suitId: string, input: CreateSuitVersionInput) {
  const suit = await db.labSuit.findFirst({ where: { id: suitId, userId } });
  if (!suit) return null;

  const version = await db.labSuitVersion.create({
    data: {
      suitId,
      label: input.label,
      note: input.note,
      parentId: input.parentVersionId,
      stats: { create: input.stats },
    },
    include: { stats: true },
  });

  if (input.makeCurrent ?? true) {
    await db.labSuit.update({ where: { id: suitId }, data: { currentVersionId: version.id } });
  }

  await recordEvent({
    userId,
    type: "lab.suit.variant_created",
    payload: { codename: suit.codename, label: input.label },
    subjectType: "LabSuit",
    subjectId: suitId,
  });

  return version;
}

export async function duplicateSuit(userId: string, id: string, newCodename: string) {
  const source = await db.labSuit.findFirst({
    where: { id, userId },
    include: { currentVersion: { include: { stats: true } }, components: true },
  });
  if (!source || !source.currentVersion?.stats) return null;

  const stats = source.currentVersion.stats;
  const copy = await createSuit({
    userId,
    projectId: source.projectId ?? undefined,
    codename: newCodename,
    designation: source.designation,
    archetype: source.archetype,
    description: source.description ?? undefined,
    colorPrimary: source.colorPrimary,
    colorSecondary: source.colorSecondary,
    silhouette: source.silhouette,
    materialLanguage: source.materialLanguage,
    patternStyle: source.patternStyle,
    armorLevel: source.armorLevel,
    maskLensStyle: source.maskLensStyle,
    status: "EXPERIMENTAL",
    versionLabel: "v0.1",
    stats: {
      stealth: stats.stealth,
      durability: stats.durability,
      mobility: stats.mobility,
      stretchiness: stats.stretchiness,
      weightKg: stats.weightKg,
      thermalLoadC: stats.thermalLoadC,
      protection: stats.protection,
      environmentalResistance: stats.environmentalResistance,
      manufacturingComplexity: stats.manufacturingComplexity,
      estimatedBuildHours: stats.estimatedBuildHours,
      estimatedCostUsd: stats.estimatedCostUsd,
      flexibility: stats.flexibility,
      impactResistance: stats.impactResistance,
      visibility: stats.visibility,
      noiseProfile: stats.noiseProfile,
      sensorCapacity: stats.sensorCapacity,
      energyRequirementW: stats.energyRequirementW,
      maintenanceComplexity: stats.maintenanceComplexity,
      confidence: "HYPOTHETICAL",
    },
  });

  for (const c of source.components.filter((c) => !c.parentId)) {
    await copyComponentSubtree(c.id, copy.id, null);
  }

  await recordEvent({
    userId,
    type: "lab.suit.prototype_generated",
    payload: { fromCodename: source.codename, toCodename: newCodename },
    subjectType: "LabSuit",
    subjectId: copy.id,
  });

  return copy;
}

async function copyComponentSubtree(sourceId: string, targetSuitId: string, targetParentId: string | null) {
  const source = await db.labComponent.findUniqueOrThrow({ where: { id: sourceId }, include: { children: true } });
  const created = await db.labComponent.create({
    data: {
      suitId: targetSuitId,
      parentId: targetParentId,
      name: source.name,
      description: source.description,
      materialId: source.materialId,
      massKg: source.massKg,
      notes: source.notes,
      confidence: source.confidence,
      order: source.order,
    },
  });
  for (const child of source.children) {
    await copyComponentSubtree(child.id, targetSuitId, created.id);
  }
}

export async function compareSuits(userId: string, ids: string[]) {
  const suits = await db.labSuit.findMany({
    where: { id: { in: ids }, userId },
    include: { currentVersion: { include: { stats: true } }, components: true },
  });
  return ids.map((id) => suits.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
}
