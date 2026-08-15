import { db } from "@/lib/db";
import type { LabConfidence } from "@/generated/prisma/enums";

export interface CreateMaterialInput {
  userId?: string;
  name: string;
  category: string;
  densityGCm3: number;
  tensileStrengthMpa: number;
  elasticityPercent: number;
  abrasionResistance: number;
  temperatureResistanceC: number;
  moistureResistance: number;
  costPerKgUsd: number;
  notes?: string;
  confidence?: LabConfidence;
}

export async function createMaterial(input: CreateMaterialInput) {
  return db.labMaterial.create({
    data: {
      userId: input.userId,
      name: input.name,
      category: input.category,
      densityGCm3: input.densityGCm3,
      tensileStrengthMpa: input.tensileStrengthMpa,
      elasticityPercent: input.elasticityPercent,
      abrasionResistance: input.abrasionResistance,
      temperatureResistanceC: input.temperatureResistanceC,
      moistureResistance: input.moistureResistance,
      costPerKgUsd: input.costPerKgUsd,
      notes: input.notes,
      confidence: input.confidence ?? "ESTIMATED",
    },
  });
}

export async function listMaterials(userId: string, category?: string) {
  return db.labMaterial.findMany({
    where: { OR: [{ userId: null }, { userId }], category },
    orderBy: { name: "asc" },
  });
}

export async function getMaterial(id: string) {
  return db.labMaterial.findUnique({ where: { id } });
}
