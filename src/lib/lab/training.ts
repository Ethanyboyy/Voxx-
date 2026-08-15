import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";

export async function listTrainingModules(category?: string) {
  return db.labTrainingModule.findMany({
    where: category ? { category: category as never } : undefined,
    orderBy: [{ difficulty: "asc" }, { name: "asc" }],
  });
}

export async function getTrainingModule(id: string) {
  return db.labTrainingModule.findUnique({
    where: { id },
    include: { sessions: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
}

export interface RecordTrainingSessionInput {
  userId: string;
  moduleId: string;
  scenarioId?: string;
  reactionTimeMs?: number;
  completionTimeS?: number;
  movementEfficiencyPercent?: number;
  staminaUsedPercent?: number;
  balanceScore?: number;
  accuracyPercent?: number;
  decisionQualityPercent?: number;
  defensiveSuccessPercent?: number;
  mistakes?: number;
  notes?: string;
}

/** Composite 0-100 score from whichever metrics a session recorded — missing
 * metrics are excluded from the average rather than defaulted to a fabricated
 * value. */
function computeScore(input: RecordTrainingSessionInput): number {
  const parts: number[] = [];
  if (input.reactionTimeMs != null) parts.push(Math.max(0, 100 - (input.reactionTimeMs - 150) / 4));
  if (input.movementEfficiencyPercent != null) parts.push(input.movementEfficiencyPercent);
  if (input.balanceScore != null) parts.push(input.balanceScore);
  if (input.accuracyPercent != null) parts.push(input.accuracyPercent);
  if (input.decisionQualityPercent != null) parts.push(input.decisionQualityPercent);
  if (input.defensiveSuccessPercent != null) parts.push(input.defensiveSuccessPercent);
  if (input.staminaUsedPercent != null) parts.push(100 - input.staminaUsedPercent);
  if (input.mistakes != null) parts.push(Math.max(0, 100 - input.mistakes * 8));
  if (parts.length === 0) return 50;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(Math.min(100, Math.max(0, avg)));
}

export async function recordTrainingSession(input: RecordTrainingSessionInput) {
  const trainingModule = await db.labTrainingModule.findUnique({ where: { id: input.moduleId } });
  if (!trainingModule) return null;

  const score = computeScore(input);
  const session = await db.labTrainingSession.create({
    data: {
      userId: input.userId,
      moduleId: input.moduleId,
      scenarioId: input.scenarioId,
      reactionTimeMs: input.reactionTimeMs,
      completionTimeS: input.completionTimeS,
      movementEfficiencyPercent: input.movementEfficiencyPercent,
      staminaUsedPercent: input.staminaUsedPercent,
      balanceScore: input.balanceScore,
      accuracyPercent: input.accuracyPercent,
      decisionQualityPercent: input.decisionQualityPercent,
      defensiveSuccessPercent: input.defensiveSuccessPercent,
      mistakes: input.mistakes,
      notes: input.notes,
      score,
      completedAt: new Date(),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.training.session_completed",
    payload: { module: trainingModule.name, score },
    subjectType: "LabTrainingSession",
    subjectId: session.id,
  });

  return session;
}

export async function listTrainingSessions(userId: string, moduleId?: string) {
  return db.labTrainingSession.findMany({
    where: { userId, moduleId },
    include: { module: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getTrainingProgress(userId: string) {
  const sessions = await db.labTrainingSession.findMany({
    where: { userId },
    include: { module: true },
    orderBy: { createdAt: "asc" },
  });
  const byCategory = new Map<string, { count: number; avgScore: number; bestScore: number }>();
  for (const s of sessions) {
    const key = s.module.category;
    const entry = byCategory.get(key) ?? { count: 0, avgScore: 0, bestScore: 0 };
    entry.avgScore = (entry.avgScore * entry.count + s.score) / (entry.count + 1);
    entry.bestScore = Math.max(entry.bestScore, s.score);
    entry.count += 1;
    byCategory.set(key, entry);
  }
  return { totalSessions: sessions.length, byCategory: Object.fromEntries(byCategory), recent: sessions.slice(-10).reverse() };
}
