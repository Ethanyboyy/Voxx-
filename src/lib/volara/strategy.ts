/**
 * [P4-F] THE SHARED STRATEGY SYSTEM.
 *
 * A strategy is a standing rule set that BOUNDS what the society may put
 * forward. The brief's verbs — PROPOSE, TEST, MEASURE, KILL, IMPROVE, RETRY,
 * REPLICATE, SCALE — are implemented as transitions on `StrategyStatus`, with
 * one division running through all of them:
 *
 *   AN AGENT MAY DRAFT AND PROPOSE. ONLY A HUMAN MAY ACTIVATE, AND ONLY A HUMAN
 *   MAY RAISE A CAP.
 *
 * `activateStrategy()` writes `activatedByHumanAt`, and the Capital Governor
 * treats `status === "ACTIVE"` as meaningless without it — so a row whose
 * status was set some other way admits nothing. `maxCapitalCents` has no
 * agent-reachable write path at all: `proposeStrategy()` takes a requested cap
 * and the human activation is where a number is actually set, which is what
 * makes "an agent cannot increase its own capital limits" structural.
 *
 * REPLICATION REQUIRES EVIDENCE, AND CARRIES NONE OF THE PARENT'S AUTHORITY. A
 * replica is created as a DRAFT with `maxCapitalCents: 0` and no activation
 * timestamp, however well the parent performed. Inheriting a cap would make a
 * successful strategy a way to mint authorized capital by copying itself, which
 * is precisely the "a winning strategy should not automatically receive
 * unlimited capital" case.
 *
 * NO RESULTS ARE STORED HERE. Revenue, profit and ROI for a strategy are
 * derived through its allocations and their opportunities (`metrics.ts`).
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { assertAgentIntentAllowed } from "@/lib/volara/guards";
import { parseIdList } from "@/lib/volara/ledger";
import type { Strategy } from "@/generated/prisma/client";
import type { RiskLevel } from "@/generated/prisma/enums";

export interface ProposeStrategyInput {
  userId: string;
  agentId: string;
  name: string;
  hypothesis: string;
  mechanism?: string;
  opportunityId?: string;
  assumptions?: string[];
  evidence?: Array<{ type: string; text: string }>;
  executionPlan?: unknown;
  /** What the author would LIKE the cap to be. Recorded, never applied. */
  requestedCapitalCents?: number;
  expectedReturnCents?: number;
  expectedDurationDays?: number;
  probabilityOfSuccess?: number;
  maxLossCents?: number;
  risk?: RiskLevel;
  targetCategories?: string[];
  correlationId: string;
}

/**
 * An agent proposes a strategy.
 *
 * Created as `PROPOSED` with `maxCapitalCents: 0`. The requested cap is kept in
 * the execution plan for a human to see and act on; it is not written to the
 * field the governor reads. That separation is the whole reason this function
 * is safe to let an agent call.
 */
export async function proposeStrategy(input: ProposeStrategyInput): Promise<Strategy> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "PROPOSE_STRATEGY",
    targetType: "Strategy",
    correlationId: input.correlationId,
  });

  const strategy = await db.strategy.create({
    data: {
      userId: input.userId,
      ownerAgentId: input.agentId,
      opportunityId: input.opportunityId,
      name: input.name,
      hypothesis: input.hypothesis,
      mechanism: input.mechanism,
      assumptions: JSON.stringify(input.assumptions ?? []),
      evidence: input.evidence ? JSON.stringify(input.evidence) : undefined,
      participatingAgentIds: JSON.stringify([input.agentId]),
      executionPlan: JSON.stringify({
        plan: input.executionPlan ?? null,
        // Recorded as a REQUEST, in a field nothing reads to decide anything.
        requestedCapitalCents: input.requestedCapitalCents ?? 0,
      }),
      status: "PROPOSED",
      // Zero, always. Only `activateStrategy()` — a human act — sets this.
      maxCapitalCents: 0,
      expectedReturnCents: input.expectedReturnCents,
      expectedDurationDays: input.expectedDurationDays,
      probabilityOfSuccess: input.probabilityOfSuccess,
      maxLossCents: input.maxLossCents,
      risk: input.risk,
      targetCategories: JSON.stringify(input.targetCategories ?? []),
      correlationId: input.correlationId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_PROPOSED,
    subjectType: "Strategy",
    subjectId: strategy.id,
    consequential: false,
    payload: {
      agentId: input.agentId,
      name: strategy.name,
      opportunityId: strategy.opportunityId,
      requestedCapitalCents: input.requestedCapitalCents ?? 0,
      correlationId: input.correlationId,
    },
  });

  return strategy;
}

export type StrategyTransitionRefusal = "NOT_FOUND" | "WRONG_STATUS" | "TERMINAL" | "NOT_HUMAN_ACTIVATED";

/**
 * THE HUMAN ACT. Sets the cap and the activation timestamp together.
 *
 * There is no agent-reachable caller: `screenAgentIntent()` has no
 * `ACTIVATE_STRATEGY` intent, so an agent that tried would be refused for
 * `UNKNOWN_INTENT` and suspended. The cap is clamped to non-negative, because a
 * negative cap would make `committed + requested > max` trivially true and read
 * as a permanent refusal rather than the misconfiguration it is.
 */
export async function activateStrategy(input: {
  userId: string;
  strategyId: string;
  maxCapitalCents: number;
  correlationId: string;
}): Promise<{ activated: true; strategy: Strategy } | { activated: false; reason: StrategyTransitionRefusal }> {
  const existing = await db.strategy.findFirst({ where: { id: input.strategyId, userId: input.userId } });
  if (!existing) return { activated: false, reason: "NOT_FOUND" };
  if (existing.status === "KILLED" || existing.status === "COMPLETED") {
    return { activated: false, reason: "TERMINAL" };
  }
  if (existing.status !== "PROPOSED" && existing.status !== "DRAFT" && existing.status !== "PAUSED") {
    return { activated: false, reason: "WRONG_STATUS" };
  }

  const strategy = await db.strategy.update({
    where: { id: existing.id },
    data: {
      status: "ACTIVE",
      maxCapitalCents: Math.max(0, Math.trunc(input.maxCapitalCents)),
      activatedByHumanAt: new Date(),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_ACTIVATED,
    subjectType: "Strategy",
    subjectId: strategy.id,
    consequential: true,
    payload: {
      maxCapitalCents: strategy.maxCapitalCents,
      ownerAgentId: strategy.ownerAgentId,
      correlationId: input.correlationId,
    },
  });

  return { activated: true, strategy };
}

/** The human "no" on a proposal. Creates nothing, activates nothing. */
export async function rejectStrategy(input: {
  userId: string;
  strategyId: string;
  reason: string;
  correlationId: string;
}): Promise<{ rejected: boolean }> {
  const rejected = await db.strategy.updateMany({
    where: { id: input.strategyId, userId: input.userId, status: { in: ["DRAFT", "PROPOSED"] } },
    data: { status: "KILLED", outcomeReason: input.reason, killedAt: new Date() },
  });
  if (rejected.count !== 1) return { rejected: false };

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_REJECTED,
    subjectType: "Strategy",
    subjectId: input.strategyId,
    consequential: true,
    payload: { reason: input.reason, correlationId: input.correlationId },
  });
  return { rejected: true };
}

/**
 * Stops a strategy and everything reserved under it.
 *
 * Killing releases nothing automatically — the allocations stay as they are,
 * and freeing one is `releaseCapitalAllocation()`, a separate screened act.
 * Cascading a release from here would mean a strategy transition silently moved
 * money, and the whole design keeps money movement in one place.
 */
export async function killStrategy(input: {
  userId: string;
  strategyId: string;
  reason: string;
  correlationId: string;
}): Promise<{ killed: boolean }> {
  const killed = await db.strategy.updateMany({
    where: { id: input.strategyId, userId: input.userId, status: { notIn: ["KILLED", "COMPLETED"] } },
    data: { status: "KILLED", outcomeReason: input.reason, killedAt: new Date() },
  });
  if (killed.count !== 1) return { killed: false };

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_KILLED,
    subjectType: "Strategy",
    subjectId: input.strategyId,
    consequential: true,
    payload: { reason: input.reason, correlationId: input.correlationId },
  });
  return { killed: true };
}

/** Reversible stop. Distinct from KILLED: paused has not been judged. */
export async function pauseStrategy(input: {
  userId: string;
  strategyId: string;
  reason: string;
  correlationId: string;
}): Promise<{ paused: boolean }> {
  const paused = await db.strategy.updateMany({
    where: { id: input.strategyId, userId: input.userId, status: { in: ["ACTIVE", "TESTING", "MEASURING"] } },
    data: { status: "PAUSED", outcomeReason: input.reason },
  });
  if (paused.count !== 1) return { paused: false };

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_PAUSED,
    subjectType: "Strategy",
    subjectId: input.strategyId,
    consequential: true,
    payload: { reason: input.reason, correlationId: input.correlationId },
  });
  return { paused: true };
}

export type ReplicationRefusal = "NOT_FOUND" | "NO_EVIDENCE_OF_SUCCESS";

/**
 * Copies a strategy that has recorded evidence of working.
 *
 * TWO PROPERTIES, BOTH DELIBERATE:
 *
 *   1. Evidence is required, and it is read from the ledger — realized profit
 *      across the parent's allocations' opportunities — never from the parent's
 *      own `lessons` or an agent's claim.
 *   2. The replica inherits the THESIS and nothing else that matters. Status
 *      DRAFT, `maxCapitalCents: 0`, no activation timestamp. A human decides,
 *      again, whether the copy may spend anything.
 */
export async function replicateStrategy(input: {
  userId: string;
  agentId: string;
  strategyId: string;
  correlationId: string;
}): Promise<{ replicated: true; strategy: Strategy } | { replicated: false; reason: ReplicationRefusal }> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "DRAFT_STRATEGY",
    targetType: "Strategy",
    correlationId: input.correlationId,
  });

  const parent = await db.strategy.findFirst({
    where: { id: input.strategyId, userId: input.userId },
    include: { allocations: { select: { opportunityId: true } } },
  });
  if (!parent) return { replicated: false, reason: "NOT_FOUND" };

  const opportunityIds = parent.allocations
    .map((allocation) => allocation.opportunityId)
    .filter((id): id is string => id !== null);
  const realizedProfitCents = await realizedProfitForOpportunities(input.userId, opportunityIds);
  if (realizedProfitCents <= 0) return { replicated: false, reason: "NO_EVIDENCE_OF_SUCCESS" };

  const participants = parseIdList(parent.participatingAgentIds);
  if (!participants.includes(input.agentId)) participants.push(input.agentId);

  const strategy = await db.strategy.create({
    data: {
      userId: input.userId,
      ownerAgentId: input.agentId,
      opportunityId: parent.opportunityId,
      name: `${parent.name} (replica)`,
      hypothesis: parent.hypothesis,
      mechanism: parent.mechanism,
      assumptions: parent.assumptions,
      evidence: parent.evidence,
      participatingAgentIds: JSON.stringify(participants),
      executionPlan: parent.executionPlan,
      // A DRAFT with no cap and no human activation. See the note above.
      status: "DRAFT",
      maxCapitalCents: 0,
      expectedReturnCents: parent.expectedReturnCents,
      expectedDurationDays: parent.expectedDurationDays,
      probabilityOfSuccess: parent.probabilityOfSuccess,
      maxLossCents: parent.maxLossCents,
      risk: parent.risk,
      targetCategories: parent.targetCategories,
      replicatedFromId: parent.id,
      correlationId: input.correlationId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.STRATEGY_REPLICATED,
    subjectType: "Strategy",
    subjectId: strategy.id,
    consequential: false,
    payload: {
      replicatedFromId: parent.id,
      agentId: input.agentId,
      evidenceRealizedProfitCents: realizedProfitCents,
      correlationId: input.correlationId,
    },
  });

  return { replicated: true, strategy };
}

/** Appends a lesson. Durable Memory promotion is `learning.ts`, deliberately not here. */
export async function recordStrategyLesson(input: {
  userId: string;
  agentId: string;
  strategyId: string;
  lesson: string;
  correlationId: string;
}): Promise<{ recorded: boolean }> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "RECORD_LESSON",
    targetType: "Strategy",
    targetId: input.strategyId,
    correlationId: input.correlationId,
  });

  const strategy = await db.strategy.findFirst({ where: { id: input.strategyId, userId: input.userId } });
  if (!strategy) return { recorded: false };

  const lessons = parseIdList(strategy.lessons);
  lessons.push(input.lesson);
  await db.strategy.update({ where: { id: strategy.id }, data: { lessons: JSON.stringify(lessons) } });
  return { recorded: true };
}

/** Realized profit across a set of opportunities, from the ledger only. */
export async function realizedProfitForOpportunities(userId: string, opportunityIds: string[]): Promise<number> {
  if (opportunityIds.length === 0) return 0;
  const assets = await db.economicAsset.findMany({
    where: { userId, opportunityId: { in: opportunityIds } },
    select: { id: true },
  });
  if (assets.length === 0) return 0;
  const assetIds = assets.map((asset) => asset.id);

  const [revenue, expense] = await Promise.all([
    db.economicRevenue.aggregate({
      where: { assetId: { in: assetIds }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { assetId: { in: assetIds }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
    }),
  ]);
  return (revenue._sum.amountCents ?? 0) - (expense._sum.amountCents ?? 0);
}

/** Strategies a human has actually activated — the only ones capital may flow under. */
export async function listActiveStrategies(userId: string): Promise<Strategy[]> {
  return db.strategy.findMany({
    where: { userId, status: "ACTIVE", activatedByHumanAt: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listStrategies(userId: string, limit = 50): Promise<Strategy[]> {
  return db.strategy.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: Math.min(limit, 200) });
}
