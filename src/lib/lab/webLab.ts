import { db } from "@/lib/db";
import { computeWebLoadModel } from "@/lib/lab/physics";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence } from "@/generated/prisma/enums";

export interface CreateWebProfileInput {
  userId: string;
  projectId?: string;
  name: string;
  description?: string;
  material: {
    densityGCm3: number;
    tensileStrengthMpa: number;
    elasticityPercent: number;
    abrasionResistance: number;
    temperatureResistanceC: number;
    moistureResistance: number;
    storageVolumeCm3: number;
    massG: number;
    confidence?: LabConfidence;
  };
  deployment: {
    deploymentSpeedMs: number;
    lineLengthM: number;
    cartridgeSizeCm3: number;
    systemMassG: number;
    energyRequirementJ: number;
    deploymentReliabilityPct: number;
    confidence?: LabConfidence;
  };
  attachment: {
    attachmentType: string;
    theoreticalHoldingStrengthN: number;
    environmentalAssumptions: string;
    geometry: string;
    structuralAssumptions: string;
    estimatedFailureProbabilityPct: number;
    confidence?: LabConfidence;
  };
}

export async function createWebProfile(input: CreateWebProfileInput) {
  const profile = await db.labWebProfile.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      material: { create: { ...input.material, confidence: input.material.confidence ?? "HYPOTHETICAL" } },
      deployment: { create: { ...input.deployment, confidence: input.deployment.confidence ?? "HYPOTHETICAL" } },
      attachment: { create: { ...input.attachment, confidence: input.attachment.confidence ?? "HYPOTHETICAL" } },
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.web_profile.created",
    payload: { name: profile.name },
    subjectType: "LabWebProfile",
    subjectId: profile.id,
  });

  return profile;
}

export async function listWebProfiles(userId: string) {
  return db.labWebProfile.findMany({
    where: { userId },
    include: { material: true, deployment: true, attachment: true, loadModels: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getWebProfile(userId: string, id: string) {
  return db.labWebProfile.findFirst({
    where: { id, userId },
    include: {
      material: true,
      deployment: true,
      attachment: true,
      loadModels: { orderBy: { createdAt: "desc" } },
    },
  });
}

export interface AddLoadModelInput {
  label: string;
  userMassKg: number;
  equipmentMassKg: number;
  swingRadiusM: number;
  velocityMs: number;
  gravityMs2?: number;
}

export async function addLoadModel(userId: string, profileId: string, input: AddLoadModelInput) {
  const profile = await db.labWebProfile.findFirst({ where: { id: profileId, userId } });
  if (!profile) return null;

  const computed = computeWebLoadModel(input);
  const safetyMarginPct =
    ((100 - Math.min(100, (computed.tensionN / Math.max(computed.staticLoadN, 1)) * 20)) / 100) * 100;

  const model = await db.labWebLoadModel.create({
    data: {
      profileId,
      label: input.label,
      userMassKg: input.userMassKg,
      equipmentMassKg: input.equipmentMassKg,
      swingRadiusM: input.swingRadiusM,
      velocityMs: input.velocityMs,
      staticLoadN: computed.staticLoadN,
      dynamicLoadN: computed.dynamicLoadN,
      accelerationMs2: computed.accelerationMs2,
      forceN: computed.forceN,
      tensionN: computed.tensionN,
      safetyMarginPct: Number(safetyMarginPct.toFixed(1)),
      confidence: "HYPOTHETICAL",
    },
  });

  await recordEvent({
    userId,
    type: "lab.web_profile.load_model_computed",
    payload: { profileName: profile.name, label: input.label },
    subjectType: "LabWebProfile",
    subjectId: profileId,
  });

  return model;
}
