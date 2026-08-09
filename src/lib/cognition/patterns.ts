import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { PatternType } from "@/generated/prisma/enums";

const STALE_IDEA_DAYS = 14;
const STALE_DECISION_DAYS = 7;

/**
 * Upserts a Pattern by (userId, type): bumps occurrenceCount and
 * lastDetectedAt if one is already ACTIVE, otherwise creates a new one.
 * Always phrased neutrally ("pattern detected" / "possible loop") and never
 * as a diagnosis — see AGENTS spec in ARCHITECTURE.md.
 */
async function upsertPattern(userId: string, type: PatternType, description: string) {
  const existing = await db.pattern.findFirst({ where: { userId, type, status: "ACTIVE" } });
  if (existing) {
    return db.pattern.update({
      where: { id: existing.id },
      data: { description, occurrenceCount: { increment: 1 }, lastDetectedAt: new Date() },
    });
  }
  return db.pattern.create({
    data: { userId, type, description, confidence: "LOW", status: "ACTIVE" },
  });
}

/**
 * Runs a small set of neutral, explainable heuristics over existing data and
 * records/updates Pattern rows. Intended to be triggered on demand (e.g.
 * from the Cognition page) rather than as a hidden background job.
 */
export async function detectPatterns(userId: string) {
  const detected: Awaited<ReturnType<typeof upsertPattern>>[] = [];
  const staleIdeaCutoff = new Date(Date.now() - STALE_IDEA_DAYS * 24 * 60 * 60 * 1000);
  const staleDecisionCutoff = new Date(Date.now() - STALE_DECISION_DAYS * 24 * 60 * 60 * 1000);

  const staleIdeas = await db.idea.findMany({
    where: {
      userId,
      status: { in: ["CAPTURED", "EXPLORING"] },
      createdAt: { lte: staleIdeaCutoff },
    },
  });
  if (staleIdeas.length >= 3) {
    detected.push(
      await upsertPattern(
        userId,
        "IDEA_WITHOUT_EXECUTION",
        `${staleIdeas.length} ideas have been captured or explored for ${STALE_IDEA_DAYS}+ days without moving to an experiment. Possible loop: idea expansion without execution.`
      )
    );
  }

  const pendingDecisions = await db.decision.findMany({
    where: { userId, status: "PENDING", createdAt: { lte: staleDecisionCutoff } },
  });
  if (pendingDecisions.length >= 2) {
    detected.push(
      await upsertPattern(
        userId,
        "UNRESOLVED_DECISION",
        `${pendingDecisions.length} decisions have been pending for ${STALE_DECISION_DAYS}+ days. Pattern detected: unresolved decisions accumulating.`
      )
    );
  }

  const revisitedDecisions = await db.decision.count({ where: { userId, status: "REVISITED" } });
  if (revisitedDecisions >= 2) {
    detected.push(
      await upsertPattern(
        userId,
        "RECONSIDERATION",
        `${revisitedDecisions} decisions have been revisited after being made. Possible pattern of repeated reconsideration.`
      )
    );
  }

  const inProgressTasks = await db.task.findMany({
    where: { userId, status: "IN_PROGRESS" },
    select: { projectId: true },
  });
  const distinctProjects = new Set(inProgressTasks.map((t) => t.projectId).filter(Boolean));
  if (inProgressTasks.length >= 3 && distinctProjects.size >= 3) {
    detected.push(
      await upsertPattern(
        userId,
        "TASK_SWITCHING",
        `${inProgressTasks.length} tasks are in progress across ${distinctProjects.size} different projects at once. Possible task-switching pattern.`
      )
    );
  }

  if (detected.length > 0) {
    await recordEvent({
      userId,
      type: "cognition.patterns_detected",
      payload: { count: detected.length, types: detected.map((p) => p.type) },
    });
  }

  return detected;
}

export async function listPatterns(userId: string) {
  return db.pattern.findMany({ where: { userId }, orderBy: { lastDetectedAt: "desc" } });
}

export async function dismissPattern(userId: string, id: string) {
  const existing = await db.pattern.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.pattern.update({ where: { id }, data: { status: "DISMISSED" } });
}
