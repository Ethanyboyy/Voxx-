/**
 * [P4-F] THE CAPITAL GOVERNOR.
 *
 * Two functions live here and they answer different questions, kept apart for
 * the same reason `evaluatePolicy()` and `enforceExecution()` are kept apart:
 *
 *   evaluateCapitalRequest()  — is this request WELL-FORMED and within every
 *                               bound? Pure, deterministic, numbers and enums
 *                               only. Never approves anything.
 *   approveCapitalAllocation() — one atomic statement that reserves the money,
 *                               callable ONLY from inside an enforced policy
 *                               scope that a human's ApprovalGrant opened.
 *
 * A PASS FROM THE FIRST IS NOT AN APPROVAL. It means only "this is coherent
 * enough to put to a human". EVERY allocation, of every size, requires a human
 * approval through the existing `ApprovalGrant` path. There is no auto-approve
 * threshold, because a threshold is the first thing an adversary tunes and the
 * first thing a well-meaning contributor raises.
 *
 * NO MODEL TEXT REACHES THIS MODULE. `evaluateCapitalRequest()` takes integers,
 * enums and booleans — the same discipline `evaluatePolicy()` follows — so an
 * agent's rationale, however persuasive, cannot move a single decision. The
 * rationale is stored and displayed; it is never an input.
 *
 * DYNAMIC, NOT EQUAL SHARES. The governor reads recorded performance —
 * realized profit under a strategy, an agent's failure history, current
 * concentration — and uses it in exactly one direction: to REFUSE more often.
 * Evidence can never raise a cap; it can only fail to lower one. That
 * asymmetry is what makes "a winning strategy does not receive unlimited
 * capital" structural rather than a policy someone remembers to apply.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import { assertExecutionAuthorized } from "@/lib/policy/gate";
import { STEP_APPROVAL_TARGET_TYPE } from "@/lib/policy/approvals";
import { formatCents } from "@/lib/economic/money";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { assertAgentIntentAllowed } from "@/lib/volara/guards";
import {
  getTreasuryPosition,
  getStrategyCommittedCents,
  getAgentCommittedCents,
  type TreasuryPosition,
} from "@/lib/volara/treasury";
import type { CapitalAllocation } from "@/generated/prisma/client";

/** Why the governor refused. Codes, so no caller parses prose. */
export type GovernorRefusal =
  | "AMOUNT_NOT_FINITE"
  | "NON_POSITIVE_AMOUNT"
  | "HALTED"
  | "AGENT_NOT_FOUND"
  | "AGENT_SUSPENDED"
  | "AGENT_CAP_EXCEEDED"
  | "NO_STRATEGY"
  | "STRATEGY_NOT_ACTIVE"
  | "STRATEGY_CAP_EXCEEDED"
  | "INSUFFICIENT_CAPITAL"
  | "RESERVE_FLOOR_BREACHED"
  | "CONCENTRATION_LIMIT"
  | "MAX_LOSS_UNACCEPTABLE"
  | "RECENT_FAILURES"
  | "DUPLICATE_LIVE_REQUEST";

/**
 * The fraction of the ceiling the governor will never let autonomous
 * allocations reach, so a human always has room to record a real expense
 * without the ledger being pre-committed to the last cent.
 *
 * A reserve floor rather than a hard "leave $X": the ceiling is a per-account
 * setting that can be any size, and a fixed dollar reserve would be
 * meaningless at one scale and prohibitive at another.
 */
export const RESERVE_FRACTION = 0.2;

/**
 * No single agent may hold more than this share of the CEILING.
 *
 * Measured against the ceiling rather than against everything currently
 * committed, which is the version that actually means something: with one
 * active agent, "no more than half of what is committed" is unsatisfiable the
 * moment that agent holds anything, since it holds all of it. Against the
 * ceiling the bound is well-defined at any society size and does not tighten as
 * agents are added.
 */
export const CONCENTRATION_FRACTION = 0.5;

/** Consecutive failures after which an agent's requests are refused outright. */
export const FAILURE_REFUSAL_THRESHOLD = 2;

/** Everything `evaluateCapitalRequest()` is allowed to look at. */
export interface CapitalRequestFacts {
  requestedCents: number;
  /** The derived position. Never a stored balance. */
  position: Pick<TreasuryPosition, "ceilingCents" | "spentCents" | "reservedCents" | "availableCents" | "halted">;
  agent: {
    found: boolean;
    suspended: boolean;
    maxRequestCents: number;
    committedCents: number;
    consecutiveFailures: number;
  };
  strategy:
    | {
        present: true;
        active: boolean;
        maxCapitalCents: number;
        committedCents: number;
        /** Honest estimate or null. Null is treated as the worst case. */
        maxLossCents: number | null;
      }
    | { present: false };
  /** A live REQUESTED row for the same agent, strategy and amount already exists. */
  duplicateLiveRequest: boolean;
}

export interface GovernorVerdict {
  /** "PASS" means only: coherent enough to put to a human. */
  verdict: "PASS" | "REFUSE";
  reasons: GovernorRefusal[];
  /** What the governor would let a human approve at most. Never above requested. */
  allowableCents: number;
}

/**
 * The deterministic evaluation. Pure: reads nothing, writes nothing, and given
 * the same facts always returns the same verdict — which is what makes it
 * testable as a table rather than as a scenario.
 *
 * Every reason is collected, not just the first, because an operator looking at
 * a refusal wants all of them.
 */
export function evaluateCapitalRequest(facts: CapitalRequestFacts): GovernorVerdict {
  const reasons: GovernorRefusal[] = [];
  const requested = facts.requestedCents;

  // Non-finite first. A NaN would make every comparison below false, which
  // reads as "passed every check" in the wrong direction — the same trap
  // `normalizeAmount()` exists to close on the spend path.
  if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
    return { verdict: "REFUSE", reasons: ["AMOUNT_NOT_FINITE"], allowableCents: 0 };
  }
  if (requested <= 0) {
    return { verdict: "REFUSE", reasons: ["NON_POSITIVE_AMOUNT"], allowableCents: 0 };
  }

  if (facts.position.halted) reasons.push("HALTED");
  if (!facts.agent.found) reasons.push("AGENT_NOT_FOUND");
  if (facts.agent.suspended) reasons.push("AGENT_SUSPENDED");
  if (facts.agent.consecutiveFailures >= FAILURE_REFUSAL_THRESHOLD) reasons.push("RECENT_FAILURES");
  if (facts.duplicateLiveRequest) reasons.push("DUPLICATE_LIVE_REQUEST");

  // The per-agent cap. Zero — the default — means the agent may request
  // nothing, so a newly seeded agent is inert until a human decides otherwise.
  if (requested > facts.agent.maxRequestCents) reasons.push("AGENT_CAP_EXCEEDED");

  // A strategy is REQUIRED. Capital without a stated, human-activated thesis is
  // exactly the "agent decided to spend money" case this whole phase exists to
  // prevent.
  if (!facts.strategy.present) {
    reasons.push("NO_STRATEGY");
  } else {
    if (!facts.strategy.active) reasons.push("STRATEGY_NOT_ACTIVE");
    if (facts.strategy.committedCents + requested > facts.strategy.maxCapitalCents) {
      reasons.push("STRATEGY_CAP_EXCEEDED");
    }
    // A null maxLoss is the worst case, not the best: an unstated downside is
    // an unbounded one until someone states it.
    const maxLoss = facts.strategy.maxLossCents;
    if (maxLoss === null || maxLoss > facts.strategy.maxCapitalCents) reasons.push("MAX_LOSS_UNACCEPTABLE");
  }

  // The reserve floor, computed from the ceiling so it scales with the account.
  const reserveFloor = Math.ceil(facts.position.ceilingCents * RESERVE_FRACTION);
  const spendableCents = Math.max(0, facts.position.availableCents - reserveFloor);
  if (requested > facts.position.availableCents) reasons.push("INSUFFICIENT_CAPITAL");
  else if (requested > spendableCents) reasons.push("RESERVE_FLOOR_BREACHED");

  // Concentration: how much of the ceiling one agent may hold at once.
  const concentrationCap = Math.floor(facts.position.ceilingCents * CONCENTRATION_FRACTION);
  if (facts.agent.committedCents + requested > concentrationCap) reasons.push("CONCENTRATION_LIMIT");

  if (reasons.length > 0) return { verdict: "REFUSE", reasons, allowableCents: 0 };

  // The allowable amount is the MINIMUM of every bound, never a negotiated
  // middle. It cannot exceed what was requested: the governor's job is to allow
  // less, never more.
  const allowableCents = Math.min(
    requested,
    facts.agent.maxRequestCents,
    spendableCents,
    concentrationCap - facts.agent.committedCents,
    facts.strategy.present ? facts.strategy.maxCapitalCents - facts.strategy.committedCents : 0
  );
  return { verdict: "PASS", reasons: [], allowableCents: Math.max(0, allowableCents) };
}

/** Gathers the facts from the database, then evaluates. No decision logic here. */
export async function gatherAndEvaluate(input: {
  userId: string;
  agentId: string;
  strategyId?: string | null;
  requestedCents: number;
  /**
   * The allocation being decided, excluded from the duplicate scan.
   *
   * Without this, re-evaluating an existing request at approval time finds
   * ITSELF — it is still `REQUESTED`, by the same agent, for the same amount —
   * and refuses every allocation as its own duplicate. The check is meant to
   * catch an agent asking twice, not to catch a request being looked at twice.
   */
  excludeAllocationId?: string;
}): Promise<{ verdict: GovernorVerdict; facts: CapitalRequestFacts; position: TreasuryPosition }> {
  const [position, agent, strategy, agentCommitted, duplicate] = await Promise.all([
    getTreasuryPosition(input.userId),
    db.agent.findFirst({
      where: { id: input.agentId, userId: input.userId },
      select: { id: true, runtimeState: true, maxRequestCents: true, consecutiveFailures: true },
    }),
    input.strategyId
      ? db.strategy.findFirst({
          where: { id: input.strategyId, userId: input.userId },
          select: { id: true, status: true, maxCapitalCents: true, maxLossCents: true, activatedByHumanAt: true },
        })
      : Promise.resolve(null),
    getAgentCommittedCents(input.userId, input.agentId),
    db.capitalAllocation.count({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        strategyId: input.strategyId ?? undefined,
        requestedCents: input.requestedCents,
        status: "REQUESTED",
        ...(input.excludeAllocationId ? { id: { not: input.excludeAllocationId } } : {}),
      },
    }),
  ]);

  const strategyCommitted = input.strategyId ? await getStrategyCommittedCents(input.userId, input.strategyId) : 0;

  const facts: CapitalRequestFacts = {
    requestedCents: input.requestedCents,
    position,
    agent: {
      found: agent !== null,
      suspended: agent?.runtimeState === "SUSPENDED" || agent?.runtimeState === "PAUSED",
      maxRequestCents: agent?.maxRequestCents ?? 0,
      committedCents: agentCommitted,
      consecutiveFailures: agent?.consecutiveFailures ?? 0,
    },
    strategy: strategy
      ? {
          present: true,
          // ACTIVE alone is not enough: the human activation timestamp is what
          // makes ACTIVE mean a person said yes, and a row whose status was set
          // without it does not count.
          active: strategy.status === "ACTIVE" && strategy.activatedByHumanAt !== null,
          maxCapitalCents: strategy.maxCapitalCents,
          committedCents: strategyCommitted,
          maxLossCents: strategy.maxLossCents,
        }
      : { present: false },
    duplicateLiveRequest: duplicate > 0,
  };

  return { verdict: evaluateCapitalRequest(facts), facts, position };
}

/** How long a capital request stays actionable before it expires. */
export const CAPITAL_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export interface RequestCapitalInput {
  userId: string;
  agentId: string;
  strategyId?: string;
  opportunityId?: string;
  requestedCents: number;
  rationale: string;
  correlationId: string;
  /** Collapses a retried request onto one row. Generated when omitted. */
  idempotencyKey?: string;
}

export type RequestCapitalResult =
  | { requested: true; allocation: CapitalAllocation; verdict: GovernorVerdict; reused: boolean }
  | { requested: false; reasons: GovernorRefusal[]; verdict: GovernorVerdict };

/**
 * An agent asks for capital. THE ONLY STATUS THIS CAN PRODUCE IS `REQUESTED`.
 *
 * Note what it does not do: it mints no grant, it reserves nothing, and it
 * moves no money. It writes a row saying an agent asked, records the governor's
 * verdict on it, and stops. Turning that row into a reservation needs a human,
 * and the path there is the existing approval machinery.
 *
 * A REFUSED request is still recorded, as a `capital.refused` event with the
 * reasons — a refusal that left no trace would make the governor unauditable.
 */
export async function requestCapital(input: RequestCapitalInput): Promise<RequestCapitalResult> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "REQUEST_CAPITAL",
    targetType: "CapitalAllocation",
    correlationId: input.correlationId,
  });

  // IDEMPOTENCY IS CHECKED FIRST, before the governor runs.
  //
  // Order matters here and the wrong order is subtle: evaluating first means a
  // retry of an already-recorded request finds its own row in the duplicate
  // scan and is refused as a duplicate of itself. A retry must return what it
  // already produced, which is what makes the operation safe against a re-fired
  // cycle rather than merely detectable.
  const idempotencyKey = input.idempotencyKey ?? `${input.correlationId}:${input.agentId}:${input.requestedCents}`;
  const existing = await db.capitalAllocation.findUnique({ where: { idempotencyKey } });

  const { verdict, position } = await gatherAndEvaluate({
    userId: input.userId,
    agentId: input.agentId,
    strategyId: input.strategyId ?? null,
    requestedCents: input.requestedCents,
    excludeAllocationId: existing?.id,
  });

  if (existing) return { requested: true, allocation: existing, verdict, reused: true };

  if (verdict.verdict === "REFUSE") {
    await recordEvent({
      userId: input.userId,
      type: VOLARA_EVENTS.CAPITAL_REFUSED,
      subjectType: "Agent",
      subjectId: input.agentId,
      consequential: true,
      payload: {
        requestedCents: input.requestedCents,
        reasons: verdict.reasons,
        strategyId: input.strategyId ?? null,
        opportunityId: input.opportunityId ?? null,
        correlationId: input.correlationId,
      },
    });
    return { requested: false, reasons: verdict.reasons, verdict };
  }

  const allocation = await db.capitalAllocation.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      strategyId: input.strategyId,
      opportunityId: input.opportunityId,
      requestedCents: input.requestedCents,
      status: "REQUESTED",
      rationale: input.rationale,
      governorVerdict: verdict.verdict,
      governorReasons: JSON.stringify(verdict.reasons),
      positionSnapshot: JSON.stringify(position),
      // The decision record the brief requires, written from real values.
      // "What result occurred" and "what happens next" are filled in at
      // decision and release time — asserting them now would be fiction.
      decisionRecord: JSON.stringify({
        whyRequested: input.rationale,
        howMuchRequested: input.requestedCents,
        governorAllowable: verdict.allowableCents,
        governorVerdict: verdict.verdict,
        awaiting: "HUMAN_APPROVAL",
      }),
      correlationId: input.correlationId,
      idempotencyKey,
      expiresAt: new Date(Date.now() + CAPITAL_REQUEST_TTL_MS),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.CAPITAL_REQUESTED,
    subjectType: "CapitalAllocation",
    subjectId: allocation.id,
    consequential: true,
    payload: {
      agentId: input.agentId,
      strategyId: input.strategyId ?? null,
      opportunityId: input.opportunityId ?? null,
      requestedCents: input.requestedCents,
      governorAllowable: verdict.allowableCents,
      correlationId: input.correlationId,
    },
  });

  return { requested: true, allocation, verdict, reused: false };
}

export type ApproveAllocationRefusal =
  | GovernorRefusal
  | "NOT_FOUND"
  | "NOT_REQUESTED"
  | "EXPIRED"
  | "RACE_LOST"
  /** No consumed ApprovalGrant is bound to this allocation's step. */
  | "NO_MATCHING_GRANT";

export type ApproveAllocationResult =
  | { approved: true; allocation: CapitalAllocation; approvedCents: number }
  | { approved: false; reasons: ApproveAllocationRefusal[] };

/**
 * RESERVES THE MONEY. The only function that writes `status: "APPROVED"`.
 *
 * FIRST LINE: `assertExecutionAuthorized("volara.allocate_capital")`. This is
 * the P4-D sink guard, and it is here rather than in the route for the reason
 * P4-D settled — a guard at the route protects the door, a guard at the sink
 * protects the room. Reaching this function without an enforced policy scope
 * that a human's ApprovalGrant opened throws `ExecutionNotAuthorizedError`, so
 * a future caller that forgets the gate fails loudly instead of quietly
 * allocating.
 *
 * THE RESERVATION ITSELF IS ONE CONDITIONAL UPDATE. Its `WHERE` clause re-checks
 * the status, the expiry and — through a correlated subquery — the halt and the
 * live availability, so two concurrent approvals cannot both reserve the same
 * money. A read-then-write pair would have a window between "there is enough"
 * and "reserve it" in which another approval spent the same headroom; this is
 * the same shape `recordPolicySpend()` uses, for the same reason.
 *
 * Re-gathering the governor's verdict before the write is NOT the safety
 * mechanism — the SQL guard is. It runs so the refusal can say WHICH bound
 * failed, and so a request that has gone stale since a human looked at it is
 * refused with a reason rather than silently.
 */
export async function approveCapitalAllocation(input: {
  userId: string;
  allocationId: string;
}): Promise<ApproveAllocationResult> {
  // THE SINK GUARD. Nothing below runs outside an enforced scope.
  assertExecutionAuthorized("volara.allocate_capital");

  const allocation = await db.capitalAllocation.findFirst({
    where: { id: input.allocationId, userId: input.userId },
  });
  if (!allocation) return { approved: false, reasons: ["NOT_FOUND"] };
  if (allocation.status !== "REQUESTED") return { approved: false, reasons: ["NOT_REQUESTED"] };
  if (allocation.expiresAt.getTime() <= Date.now()) return { approved: false, reasons: ["EXPIRED"] };

  // WHICH GRANT AUTHORIZED THIS, DERIVED — NEVER SUPPLIED.
  //
  // The caller passing a grant id was a forgery surface and, worse, was wrong
  // under concurrency: the tool guessed with "the most recently consumed grant
  // for this action", so five simultaneous approvals all recorded the SAME
  // grant and `approvalGrantId` stopped meaning anything.
  //
  // The correct binding already exists. `step-approvals.ts` mints every grant
  // against `targetType: "AgentStep"` and the step's own id, and this
  // allocation records the step it was submitted through. Looking the grant up
  // by that pair identifies exactly the human act that authorized exactly this
  // allocation — no guessing, no ordering, no parameter to forge.
  //
  // No consumed grant on that step means this execution is not the one the
  // human approved, and it refuses. That is belt-and-braces over the sink guard
  // above rather than a substitute for it.
  if (!allocation.stepId) return { approved: false, reasons: ["NO_MATCHING_GRANT"] };
  const grant = await db.approvalGrant.findFirst({
    where: {
      userId: input.userId,
      registry: "tool",
      actionId: "volara.allocate_capital",
      targetType: STEP_APPROVAL_TARGET_TYPE,
      targetId: allocation.stepId,
      consumedAt: { not: null },
    },
    orderBy: { consumedAt: "desc" },
    select: { id: true },
  });
  if (!grant) return { approved: false, reasons: ["NO_MATCHING_GRANT"] };

  const { verdict, position } = await gatherAndEvaluate({
    userId: input.userId,
    agentId: allocation.agentId,
    strategyId: allocation.strategyId,
    requestedCents: allocation.requestedCents,
    // Excluded from the duplicate scan: this row IS the request being decided,
    // and without this it matches itself and refuses every allocation.
    excludeAllocationId: allocation.id,
  });
  if (verdict.verdict === "REFUSE") {
    await recordEvent({
      userId: input.userId,
      type: VOLARA_EVENTS.CAPITAL_REFUSED,
      subjectType: "CapitalAllocation",
      subjectId: allocation.id,
      consequential: true,
      payload: { reasons: verdict.reasons, stage: "AT_APPROVAL", correlationId: allocation.correlationId },
    });
    return { approved: false, reasons: verdict.reasons };
  }

  const approvedCents = verdict.allowableCents;
  const reserveFloor = Math.ceil(position.ceilingCents * RESERVE_FRACTION);
  const now = new Date();

  // THE ATOMIC RESERVATION. Everything that can refuse it is inside the same
  // statement that performs it.
  //
  //   - status still REQUESTED       (nobody else decided it)
  //   - not expired
  //   - the account is not halted
  //   - ceiling − spent − (already reserved) − reserveFloor >= approvedCents
  //
  // The availability subquery reads the LEDGER and the ALLOCATION TABLE, not a
  // cached figure, so the rows are the only source of truth and an over-reserve
  // is impossible rather than merely unlikely.
  const reserved = await db.$executeRaw`
    UPDATE "CapitalAllocation"
    SET "status" = 'APPROVED',
        "approvedCents" = ${approvedCents},
        "approvalGrantId" = ${grant.id},
        "decidedAt" = ${now},
        "governorVerdict" = 'PASS',
        "positionSnapshot" = ${JSON.stringify(position)}
    WHERE "id" = ${allocation.id}
      AND "userId" = ${input.userId}
      AND "status" = 'REQUESTED'
      AND "expiresAt" > ${now}
      AND (SELECT COUNT(*) FROM "User" u WHERE u."id" = ${input.userId} AND u."economicHaltedAt" IS NULL) = 1
      AND ${approvedCents} <= (
        (SELECT CAST(u."maxAutonomousSpendUsd" * 100 AS INTEGER) FROM "User" u WHERE u."id" = ${input.userId})
        - COALESCE((
            SELECT SUM(e."amountCents") FROM "EconomicExpense" e
            JOIN "EconomicAsset" a ON a."id" = e."assetId"
            WHERE a."userId" = ${input.userId} AND e."provenance" IN ('REALIZED', 'USER_RECORDED')
          ), 0)
        - COALESCE((
            SELECT SUM(c."approvedCents") FROM "CapitalAllocation" c
            WHERE c."userId" = ${input.userId} AND c."status" = 'APPROVED'
          ), 0)
        - ${reserveFloor}
      )
  `;

  if (reserved === 0) {
    // The guard refused. Which condition failed is advisory — the refusal
    // already happened, atomically, above.
    await recordEvent({
      userId: input.userId,
      type: VOLARA_EVENTS.CAPITAL_REFUSED,
      subjectType: "CapitalAllocation",
      subjectId: allocation.id,
      consequential: true,
      payload: { reasons: ["RACE_LOST"], stage: "ATOMIC_GUARD", correlationId: allocation.correlationId },
    });
    return { approved: false, reasons: ["RACE_LOST"] };
  }

  const updated = await db.capitalAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
  await writeDecisionRecord(updated, {
    whyApproved: "Human approval consumed and every governor bound satisfied.",
    approvedCents,
    policy: "volara.allocate_capital / FINANCIAL+IRREVERSIBLE / HOLD",
    approvalGrantId: grant.id,
    riskAccepted: `Up to ${formatCents(approvedCents)} reserved against the autonomous ceiling.`,
    next: "RESERVED_PENDING_SPEND",
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.CAPITAL_ALLOCATED,
    subjectType: "CapitalAllocation",
    subjectId: allocation.id,
    consequential: true,
    payload: {
      agentId: allocation.agentId,
      strategyId: allocation.strategyId,
      opportunityId: allocation.opportunityId,
      requestedCents: allocation.requestedCents,
      approvedCents,
      approvalGrantId: grant.id,
      correlationId: allocation.correlationId,
    },
  });

  return { approved: true, allocation: updated, approvedCents };
}

/**
 * The human "no". Creates no grant, reserves nothing, and is deliberately not
 * the mirror image of approval: refusing needs no atomic guard because it can
 * only ever free capacity.
 */
export async function rejectCapitalAllocation(
  userId: string,
  allocationId: string,
  reason: string
): Promise<{ rejected: boolean }> {
  const rejected = await db.capitalAllocation.updateMany({
    where: { id: allocationId, userId, status: "REQUESTED" },
    data: { status: "REJECTED", decidedAt: new Date(), governorVerdict: "REFUSE" },
  });
  if (rejected.count !== 1) return { rejected: false };

  const allocation = await db.capitalAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  await writeDecisionRecord(allocation, { whyRejected: reason, approvedCents: 0, next: "CLOSED" });
  await recordEvent({
    userId,
    type: VOLARA_EVENTS.CAPITAL_REJECTED,
    subjectType: "CapitalAllocation",
    subjectId: allocationId,
    consequential: true,
    payload: { reason, correlationId: allocation.correlationId },
  });
  return { rejected: true };
}

/**
 * Gives an unspent reservation back.
 *
 * Only ever frees capital — `approvedCents` is not returned to any pool,
 * because there is no pool: `available` is derived, so dropping this row out of
 * the APPROVED set is the entire operation. It cannot create capital, which is
 * why it needs no approval of its own.
 *
 * A partially consumed allocation keeps what it spent: `consumedCents` stays,
 * and only the unspent remainder stops being reserved.
 */
export async function releaseCapitalAllocation(input: {
  userId: string;
  agentId: string;
  allocationId: string;
  correlationId: string;
  reason: string;
}): Promise<{ released: boolean; freedCents: number }> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "RELEASE_CAPITAL",
    targetType: "CapitalAllocation",
    targetId: input.allocationId,
    correlationId: input.correlationId,
  });

  const allocation = await db.capitalAllocation.findFirst({
    where: { id: input.allocationId, userId: input.userId, agentId: input.agentId, status: "APPROVED" },
  });
  if (!allocation) return { released: false, freedCents: 0 };

  const freedCents = Math.max(0, allocation.approvedCents - allocation.consumedCents);
  const released = await db.capitalAllocation.updateMany({
    where: { id: allocation.id, userId: input.userId, status: "APPROVED" },
    data: {
      status: allocation.consumedCents > 0 ? "CONSUMED" : "RELEASED",
      approvedCents: allocation.consumedCents,
      releasedAt: new Date(),
    },
  });
  if (released.count !== 1) return { released: false, freedCents: 0 };

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.CAPITAL_RELEASED,
    subjectType: "CapitalAllocation",
    subjectId: allocation.id,
    consequential: true,
    payload: { freedCents, reason: input.reason, correlationId: input.correlationId },
  });
  return { released: true, freedCents };
}

/** Merges into the stored decision record. Never throws — see the module note. */
async function writeDecisionRecord(allocation: CapitalAllocation, patch: Record<string, unknown>): Promise<void> {
  try {
    const existing = allocation.decisionRecord ? JSON.parse(allocation.decisionRecord) : {};
    await db.capitalAllocation.update({
      where: { id: allocation.id },
      data: { decisionRecord: JSON.stringify({ ...existing, ...patch }) },
    });
  } catch (error) {
    logger.error("volara.decision_record_failed", {
      allocationId: allocation.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A correlation id for a request that is not part of a running cycle. */
export function newCorrelationId(): string {
  return randomUUID();
}
