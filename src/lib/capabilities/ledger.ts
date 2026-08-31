/**
 * The provider usage ledger, and the budget that reads it.
 *
 * Every metered provider call opens a row here BEFORE the call and closes it
 * after. That ordering is the point: a crash mid-call leaves a RUNNING row
 * rather than no evidence that money was spent. A ledger that only records
 * successes systematically under-counts exactly the calls you most want to
 * know about.
 *
 * `REFUSED` is a first-class status rather than a kind of failure. A call the
 * budget declined to make is a correct outcome — the system working — and
 * conflating it with a call that was attempted and broke would make the
 * failure rate meaningless.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { Capability } from "@/lib/capabilities/types";
import { isMetered } from "@/lib/capabilities/types";

/** A correlation id grouping every run in one user-visible task. */
export function newTraceId(): string {
  return randomUUID();
}

export interface BudgetPolicy {
  /** Max metered calls per capability per rolling 24h. Absent means unlimited. */
  dailyCalls?: Partial<Record<Capability, number>>;
  /** Max total USD per rolling 24h across all capabilities. */
  dailyUsd?: number;
  /** Max QA-driven regeneration attempts for one artifact. */
  maxIterations?: number;
}

/**
 * Defaults chosen to be survivable rather than generous.
 *
 * Video is an order of magnitude more expensive than images almost everywhere,
 * so it gets an order of magnitude smaller allowance. These are overridable
 * per call; they exist so that a system left unconfigured cannot run up an
 * unbounded bill, which is the failure mode of every "we'll add limits later".
 */
export const DEFAULT_BUDGET: Required<Pick<BudgetPolicy, "dailyCalls" | "maxIterations">> & BudgetPolicy = {
  dailyCalls: {
    IMAGE_GENERATION: 100,
    IMAGE_EDIT: 100,
    VIDEO_GENERATION: 10,
    VISUAL_QA: 200,
  },
  maxIterations: 3,
};

export interface BudgetDecision {
  allowed: boolean;
  /** Why not, in terms a person can act on. Null when allowed. */
  reason: string | null;
  /** Calls already made in the window, for the capability asked about. */
  used: number;
  limit: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks the budget for one capability.
 *
 * Counts SUCCEEDED and FAILED but not REFUSED: a refusal did not reach the
 * provider, so counting it would let a burst of refusals lock the user out for
 * the rest of the window on the strength of calls that never happened.
 */
export async function checkBudget(
  userId: string,
  capability: Capability,
  policy: BudgetPolicy = DEFAULT_BUDGET,
): Promise<BudgetDecision> {
  if (!isMetered(capability)) {
    return { allowed: true, reason: null, used: 0, limit: null };
  }

  const limit = policy.dailyCalls?.[capability] ?? null;
  const since = new Date(Date.now() - DAY_MS);

  const used = await db.capabilityRun.count({
    where: {
      userId,
      capability,
      startedAt: { gte: since },
      status: { in: ["SUCCEEDED", "FAILED", "RUNNING"] },
    },
  });

  if (limit !== null && used >= limit) {
    return {
      allowed: false,
      reason: `Daily limit reached for ${capability}: ${used}/${limit} in the last 24 hours.`,
      used,
      limit,
    };
  }

  if (policy.dailyUsd !== undefined) {
    const spend = await db.capabilityRun.aggregate({
      where: { userId, startedAt: { gte: since }, status: "SUCCEEDED" },
      _sum: { costUsd: true },
    });
    const spent = spend._sum.costUsd ?? 0;
    if (spent >= policy.dailyUsd) {
      return {
        allowed: false,
        reason: `Daily spend limit reached: $${spent.toFixed(2)} of $${policy.dailyUsd.toFixed(2)}.`,
        used,
        limit,
      };
    }
  }

  return { allowed: true, reason: null, used, limit };
}

export interface OpenRunInput {
  userId: string;
  capability: Capability;
  provider: string;
  model?: string;
  traceId: string;
  agentRunId?: string;
}

/** Opens a run row and emits `provider.started`. */
export async function openRun(input: OpenRunInput) {
  const run = await db.capabilityRun.create({
    data: {
      userId: input.userId,
      capability: input.capability,
      provider: input.provider,
      model: input.model,
      traceId: input.traceId,
      agentRunId: input.agentRunId,
      status: "RUNNING",
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "provider.started",
    subjectType: "CapabilityRun",
    subjectId: run.id,
    payload: { capability: input.capability, provider: input.provider, model: input.model, traceId: input.traceId },
  });

  return run;
}

/** Closes a run as SUCCEEDED, recording measured duration and reported cost. */
export async function completeRun(
  userId: string,
  runId: string,
  outcome: { costUsd?: number | null; providerRunId?: string | null; model?: string | null } = {},
) {
  const existing = await db.capabilityRun.findFirst({ where: { id: runId, userId } });
  if (!existing) throw new Error(`Capability run ${runId} not found.`);

  const completedAt = new Date();
  const run = await db.capabilityRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      completedAt,
      durationMs: completedAt.getTime() - existing.startedAt.getTime(),
      costUsd: outcome.costUsd ?? undefined,
      providerRunId: outcome.providerRunId ?? undefined,
      model: outcome.model ?? undefined,
    },
  });

  await recordEvent({
    userId,
    type: "provider.completed",
    subjectType: "CapabilityRun",
    subjectId: run.id,
    payload: {
      capability: run.capability,
      provider: run.provider,
      durationMs: run.durationMs,
      costUsd: run.costUsd,
      traceId: run.traceId,
    },
  });

  return run;
}

/** Closes a run as FAILED. The reason is a message, never a stack trace. */
export async function failRun(userId: string, runId: string, error: string) {
  const existing = await db.capabilityRun.findFirst({ where: { id: runId, userId } });
  if (!existing) throw new Error(`Capability run ${runId} not found.`);

  const completedAt = new Date();
  const run = await db.capabilityRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      completedAt,
      durationMs: completedAt.getTime() - existing.startedAt.getTime(),
      error: error.slice(0, 500),
    },
  });

  await recordEvent({
    userId,
    type: "provider.failed",
    subjectType: "CapabilityRun",
    subjectId: run.id,
    payload: { capability: run.capability, provider: run.provider, error: run.error, traceId: run.traceId },
  });

  return run;
}

/**
 * Records a call that was declined before it happened.
 *
 * Written as a row rather than just returned, so a user asking "why didn't it
 * make the video?" has an answer in the same place as everything else.
 */
export async function refuseRun(input: OpenRunInput & { reason: string }) {
  const now = new Date();
  const run = await db.capabilityRun.create({
    data: {
      userId: input.userId,
      capability: input.capability,
      provider: input.provider,
      model: input.model,
      traceId: input.traceId,
      agentRunId: input.agentRunId,
      status: "REFUSED",
      error: input.reason.slice(0, 500),
      completedAt: now,
      durationMs: 0,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "provider.refused",
    subjectType: "CapabilityRun",
    subjectId: run.id,
    payload: { capability: input.capability, provider: input.provider, reason: input.reason, traceId: input.traceId },
  });

  return run;
}

/**
 * Every run in one trace, oldest first — the answer to "what happened?".
 */
export async function getTrace(userId: string, traceId: string) {
  return db.capabilityRun.findMany({
    where: { userId, traceId },
    orderBy: { startedAt: "asc" },
    include: { versions: { select: { id: true, artifactId: true, version: true, url: true } } },
  });
}

/** Rolling-window usage, for the settings surface and for the Brain's own limits. */
export async function getUsageSummary(userId: string, windowMs = DAY_MS) {
  const since = new Date(Date.now() - windowMs);
  const runs = await db.capabilityRun.findMany({
    where: { userId, startedAt: { gte: since } },
    select: { capability: true, status: true, costUsd: true, durationMs: true },
  });

  const byCapability = new Map<string, { calls: number; failed: number; refused: number; costUsd: number; durationMs: number }>();
  for (const run of runs) {
    const entry = byCapability.get(run.capability) ?? { calls: 0, failed: 0, refused: 0, costUsd: 0, durationMs: 0 };
    if (run.status === "REFUSED") entry.refused += 1;
    else {
      entry.calls += 1;
      if (run.status === "FAILED") entry.failed += 1;
    }
    entry.costUsd += run.costUsd ?? 0;
    entry.durationMs += run.durationMs ?? 0;
    byCapability.set(run.capability, entry);
  }

  return {
    windowMs,
    totalCalls: runs.filter((r) => r.status !== "REFUSED").length,
    totalCostUsd: runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    byCapability: Object.fromEntries(byCapability),
  };
}
