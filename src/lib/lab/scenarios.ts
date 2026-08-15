import { db } from "@/lib/db";
import type {
  LabDifficulty,
  LabScenarioEnvironment,
  LabScenarioObjectiveType,
} from "@/generated/prisma/enums";

export interface CreateScenarioInput {
  userId?: string;
  name: string;
  environment: LabScenarioEnvironment;
  objectiveType: LabScenarioObjectiveType;
  difficulty: LabDifficulty;
  description?: string;
  timeOfDay?: string;
  precipitation?: string;
  windMs?: number;
  temperatureC?: number;
  fogPercent?: number;
  gravityMs2?: number;
  surfaceType?: string;
  elevationM?: number;
  obstacleCount?: number;
  isCustom?: boolean;
}

export async function createScenario(input: CreateScenarioInput) {
  return db.labScenario.create({
    data: {
      userId: input.userId,
      name: input.name,
      environment: input.environment,
      objectiveType: input.objectiveType,
      difficulty: input.difficulty,
      description: input.description,
      timeOfDay: input.timeOfDay ?? "day",
      precipitation: input.precipitation ?? "none",
      windMs: input.windMs ?? 0,
      temperatureC: input.temperatureC ?? 18,
      fogPercent: input.fogPercent ?? 0,
      gravityMs2: input.gravityMs2 ?? 9.81,
      surfaceType: input.surfaceType ?? "concrete",
      elevationM: input.elevationM ?? 0,
      obstacleCount: input.obstacleCount ?? 0,
      isCustom: input.isCustom ?? true,
    },
  });
}

/** Seed scenarios (userId null) plus this user's custom-generated ones. */
export async function listScenarios(userId: string) {
  return db.labScenario.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    orderBy: [{ isCustom: "asc" }, { createdAt: "asc" }],
  });
}

export async function getScenario(userId: string, id: string) {
  return db.labScenario.findFirst({ where: { id, OR: [{ userId: null }, { userId }] } });
}
