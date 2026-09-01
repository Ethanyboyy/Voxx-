// The economic control loop's tick.
//
// One function, run repeatedly, that walks every live experiment contract,
// measures it against the real ledger, asks the pure decision function what to
// do, and records the answer.
//
// WHAT IT IS NOT. It is not a second execution engine. It starts no AgentRun,
// calls no provider, invokes no model, and spends no money. Everything it can
// do is either a read or a state transition on a row VOX already owns.
//
// THE BOUNDARY, STATED HONESTLY. VOX today has no payment, banking or
// purchasing capability of any kind — every Connections Hub provider throws by
// design. So when the decision layer says SCALE, this scheduler CANNOT scale
// anything, and it does not pretend otherwise: the experiment moves to
// AWAITING_HUMAN and an event records that execution stopped at the boundary.
// The alternative — marking it "scaled" and moving on — would make the P&L a
// work of fiction within a week.
//
// THE ASYMMETRY IS DELIBERATE. KILL is applied automatically; SCALE is not.
// Killing only ever reduces exposure and requires no capability VOX lacks, so
// deferring it to a human would mean a contract keeps losing money while
// waiting for someone to read a notification. Growing is the direction that
// needs a person.
//
// IDEMPOTENCY, AND WHY IT NEEDED FIXING. The tick key is a deterministic time
// bucket and EconomicTick has @@unique([userId, tickKey]), so a double-fired
// cron, a retried request or two racing containers produce ONE tick row. That
// part was right. What was wrong is that the row was created with status
// COMPLETED, BEFORE any work ran: if the process then crashed mid-evaluation,
// the bucket was permanently marked successful with zero decisions, and the
// unique constraint made it impossible to ever retry. A crash did not lose a
// tick temporarily; it lost it forever, silently, and the audit trail said the
// tick had succeeded.
//
// The lifecycle is now explicit: IN_PROGRESS -> COMPLETED | HALTED | FAILED.
//
//   * A tick is CLAIMED (created IN_PROGRESS with a lease) before work starts.
//   * It becomes COMPLETED only after the work actually finishes.
//   * A thrown error marks it FAILED with the message, and clears the lease so
//     it is immediately reclaimable.
//   * A claim whose lease has expired — the signature of a crashed worker that
//     will never come back to release anything — is reclaimable by any worker.
//   * A live claim held by another worker is left alone.
//
// RETRY IS SAFE because the work is idempotent per experiment: a decision
// applied in a partial run moved that experiment to a terminal executionStatus,
// and the next pass only selects READY/RUNNING, so it is simply not re-decided.
// The lesson write is separately idempotent (see lessons.ts) and is ordered
// BEFORE the experiment update, so a crash between the two loses neither.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { decide, type DecisionResult, type EconomicDecision } from "@/lib/economic/decide";
import { toDecisionContract } from "@/lib/economic/experiments";
import { getHaltState } from "@/lib/economic/halt";
import { recordExperimentLesson } from "@/lib/economic/lessons";
import { utcHourBucket } from "@/lib/economic/time";
import { fromCents } from "@/lib/economic/money";
import { POLICY_CONSUMING_PROVENANCES } from "@/lib/economic/accounting";
import type { EconomicTickStatus } from "@/generated/prisma/enums";

/**
 * Tick granularity. Ticks are bucketed to the hour: an economic experiment's
 * measurable state changes when money moves, not when a clock advances, so
 * evaluating more often produces identical answers and more rows.
 */
export const TICK_BUCKET_MS = 60 * 60 * 1000;

/**
 * How long a worker's claim on a tick is honoured before another worker may
 * take it over. Longer than any plausible tick (which does a bounded number of
 * small queries), short enough that a crash does not stall the loop for hours.
 */
export const TICK_LEASE_MS = 5 * 60 * 1000;

/**
 * How many times a tick may be claimed before it is left alone.
 *
 * Without this, a tick that fails deterministically — a corrupt row, a bug —
 * would be reclaimed and re-failed on every invocation forever. Exhausting the
 * attempts leaves it FAILED with its error recorded, which is a visible,
 * diagnosable end state rather than an infinite retry loop.
 */
export const MAX_TICK_ATTEMPTS = 5;

/**
 * The deterministic bucket key. Same instant in, same key out, on any machine.
 *
 * Computed in UTC: a bucket derived from local time would differ between two
 * workers in different regions, and the unique constraint that makes a tick
 * idempotent would stop meaning anything.
 */
export function tickKeyFor(now: Date): string {
  return utcHourBucket(now, TICK_BUCKET_MS).toISOString();
}

export interface ExperimentDecisionRecord {
  experimentId: string;
  decision: EconomicDecision;
  bindingConstraint: string;
  netUsd: number;
  /** What actually changed as a result. Never "executed" when nothing ran. */
  applied: "KILLED" | "AWAITING_HUMAN" | "NONE";
}

export interface EconomicTickResult {
  tickId: string;
  tickKey: string;
  status: EconomicTickStatus;
  /** True when this call created the tick; false when it was already done. */
  performed: boolean;
  evaluated: number;
  scaled: number;
  held: number;
  killed: number;
  decisions: ExperimentDecisionRecord[];
  /** Present when the tick did nothing, explaining why. */
  note: string | null;
}

/** Statuses the scheduler considers live. Terminal contracts are never re-decided. */
const LIVE_STATUSES = ["READY", "RUNNING"] as const;

function summarize(reasons: DecisionResult["reasons"]): string {
  const binding = reasons.find((r) => r.binding);
  return binding ? binding.detail : "No binding constraint recorded.";
}

export interface TickClaim {
  tickId: string;
  attempts: number;
}

/** A tick row as reported without doing any work. */
function reportExisting(tick: {
  id: string;
  status: EconomicTickStatus;
  evaluatedCount: number;
  scaleCount: number;
  holdCount: number;
  killCount: number;
  decisions: string | null;
  note: string | null;
}, tickKey: string): EconomicTickResult {
  return {
    tickId: tick.id,
    tickKey,
    status: tick.status,
    performed: false,
    evaluated: tick.evaluatedCount,
    scaled: tick.scaleCount,
    held: tick.holdCount,
    killed: tick.killCount,
    decisions: parseDecisions(tick.decisions),
    note: tick.note,
  };
}

/**
 * Claims a tick bucket for this worker, or reports why it could not.
 *
 * The whole crash-safety story lives here. Four cases:
 *
 *   1. No row yet -> create it IN_PROGRESS with a lease. A unique-constraint
 *      violation means another worker won the race; fall through to re-read.
 *   2. Row is COMPLETED or HALTED -> terminal. Nothing to do.
 *   3. Row is IN_PROGRESS with a LIVE lease -> another worker is on it. Leave
 *      it alone; do not double-process.
 *   4. Row is FAILED, or IN_PROGRESS with an EXPIRED lease (the fingerprint of
 *      a crashed worker) -> reclaim it with a conditional updateMany whose
 *      WHERE still names the exact state we decided from. If the count comes
 *      back 0, another worker reclaimed it between our read and our write, and
 *      we correctly do nothing. This is a compare-and-swap: the decision and
 *      the claim cannot drift apart.
 */
async function claimTick(userId: string, tickKey: string, now: Date): Promise<TickClaim | EconomicTickResult> {
  const leaseExpiresAt = new Date(now.getTime() + TICK_LEASE_MS);

  const existing = await db.economicTick.findUnique({ where: { userId_tickKey: { userId, tickKey } } });

  if (!existing) {
    try {
      const created = await db.economicTick.create({
        data: { userId, tickKey, status: "IN_PROGRESS", leaseExpiresAt, attempts: 1, startedAt: now },
      });
      return { tickId: created.id, attempts: 1 };
    } catch {
      const winner = await db.economicTick.findUnique({ where: { userId_tickKey: { userId, tickKey } } });
      if (!winner) throw new Error(`Economic tick ${tickKey} could not be claimed and no existing tick was found.`);
      return reportExisting(winner, tickKey);
    }
  }

  if (existing.status === "COMPLETED" || existing.status === "HALTED") {
    return reportExisting(existing, tickKey);
  }

  const leaseIsLive = existing.leaseExpiresAt !== null && existing.leaseExpiresAt > now;
  if (existing.status === "IN_PROGRESS" && leaseIsLive) {
    return { ...reportExisting(existing, tickKey), note: existing.note ?? "Another worker holds a live claim on this tick." };
  }

  if (existing.attempts >= MAX_TICK_ATTEMPTS) {
    return {
      ...reportExisting(existing, tickKey),
      note: `Tick abandoned after ${existing.attempts} attempts. Last error: ${existing.lastError ?? "unknown"}.`,
    };
  }

  // Compare-and-swap reclaim. The WHERE repeats the state we read, so a
  // concurrent reclaimer makes this a no-op rather than a double claim.
  const reclaimed = await db.economicTick.updateMany({
    where: {
      id: existing.id,
      status: existing.status,
      attempts: existing.attempts,
      ...(existing.status === "IN_PROGRESS" ? { leaseExpiresAt: { lt: now } } : {}),
    },
    data: { status: "IN_PROGRESS", leaseExpiresAt, attempts: existing.attempts + 1, lastError: null },
  });

  if (reclaimed.count !== 1) {
    const winner = await db.economicTick.findUniqueOrThrow({ where: { id: existing.id } });
    return { ...reportExisting(winner, tickKey), note: "Another worker reclaimed this tick first." };
  }

  return { tickId: existing.id, attempts: existing.attempts + 1 };
}

/**
 * Runs one tick of the economic loop.
 *
 * Safe to call more than once for the same bucket, concurrently or after a
 * crash: a finished bucket is reported with `performed: false` and re-runs
 * nothing, a live claim is respected, and an abandoned claim is recovered.
 */
export async function runEconomicTick(userId: string, now: Date = new Date()): Promise<EconomicTickResult> {
  const tickKey = tickKeyFor(now);

  const claim = await claimTick(userId, tickKey, now);
  if (!("attempts" in claim)) return claim;

  const tick = { id: claim.tickId };

  try {
    return await evaluateClaimedTick(userId, tickKey, tick.id, now);
  } catch (error) {
    // FAILED, not COMPLETED, and the lease is cleared so the tick is
    // immediately reclaimable. This is the case the previous implementation
    // could not express at all: it had already written COMPLETED before
    // starting, so a crash here left a permanently "successful" empty tick.
    const message = error instanceof Error ? error.message : String(error);
    await db.economicTick
      .update({
        where: { id: tick.id },
        data: { status: "FAILED", lastError: message.slice(0, 1000), leaseExpiresAt: null, finishedAt: now },
      })
      .catch(() => {
        // A failure to record the failure must not mask the original error.
      });

    await recordEvent({
      userId,
      type: "economic_tick.failed",
      subjectType: "EconomicTick",
      subjectId: tick.id,
      payload: { tickKey, attempt: claim.attempts, error: message.slice(0, 500) },
    }).catch(() => {});

    throw error;
  }
}

/** The tick's actual work, run only once the bucket has been claimed. */
async function evaluateClaimedTick(
  userId: string,
  tickKey: string,
  tickId: string,
  now: Date
): Promise<EconomicTickResult> {
  const tick = { id: tickId };

  const halt = await getHaltState(userId);

  // ---- The halt, enforced here and not in a UI. Nothing is evaluated, no
  // state moves, and the tick row itself records that the loop was stopped.
  if (halt.halted) {
    const note = `Global economic halt engaged${halt.reason ? `: ${halt.reason}` : ""}. No contracts evaluated.`;
    await db.economicTick.update({
      where: { id: tick.id },
      data: { status: "HALTED", note, finishedAt: new Date() },
    });
    await recordEvent({
      userId,
      type: "economic_tick.halted",
      subjectType: "EconomicTick",
      subjectId: tick.id,
      payload: { tickKey, reason: halt.reason },
    });
    return {
      tickId: tick.id,
      tickKey,
      status: "HALTED",
      performed: true,
      evaluated: 0,
      scaled: 0,
      held: 0,
      killed: 0,
      decisions: [],
      note,
    };
  }

  const [experiments, user] = await Promise.all([
    db.experiment.findMany({
      where: { userId, executionStatus: { in: [...LIVE_STATUSES] } },
      include: { opportunity: { select: { title: true } } },
    }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { maxAutonomousSpendUsd: true } }),
  ]);

  const decisions: ExperimentDecisionRecord[] = [];
  let scaled = 0;
  let held = 0;
  let killed = 0;

  for (const experiment of experiments) {
    const contract = toDecisionContract(experiment);
    if (!contract) {
      // A live experiment whose contract stopped being executable (someone
      // blanked a term) is not guessed at. It is parked, loudly.
      await db.experiment.update({
        where: { id: experiment.id },
        data: {
          executionStatus: "AWAITING_HUMAN",
          lastDecision: "HOLD",
          lastDecisionReason: "Contract is incomplete or incoherent; it cannot be evaluated deterministically.",
          lastDecisionAt: now,
        },
      });
      decisions.push({
        experimentId: experiment.id,
        decision: "HOLD",
        bindingConstraint: "CONTRACT_NOT_EXECUTABLE",
        netUsd: 0,
        applied: "AWAITING_HUMAN",
      });
      held++;
      continue;
    }

    const actual = await measureExperiment(experiment.economicAssetId);
    const result = decide({
      contract,
      actual,
      now,
      halted: false, // already returned above if halted
      policyCeilingUsd: user.maxAutonomousSpendUsd,
    });

    const record = await applyDecision({
      userId,
      experiment,
      subject: experiment.opportunity?.title ?? null,
      contractMaxLossUsd: contract.maxLossUsd,
      result,
      actual,
      now,
    });

    decisions.push(record);
    if (result.decision === "SCALE") scaled++;
    else if (result.decision === "KILL") killed++;
    else held++;
  }

  await db.economicTick.update({
    where: { id: tick.id },
    data: {
      status: "COMPLETED",
      evaluatedCount: experiments.length,
      scaleCount: scaled,
      holdCount: held,
      killCount: killed,
      decisions: JSON.stringify(decisions),
      finishedAt: new Date(),
    },
  });

  await recordEvent({
    userId,
    type: "economic_tick.completed",
    subjectType: "EconomicTick",
    subjectId: tick.id,
    payload: { tickKey, evaluated: experiments.length, scaled, held, killed },
  });

  return {
    tickId: tick.id,
    tickKey,
    status: "COMPLETED",
    performed: true,
    evaluated: experiments.length,
    scaled,
    held,
    killed,
    decisions,
    note: null,
  };
}

/** Reads an experiment's real ledger. No asset means nothing has moved. */
async function measureExperiment(economicAssetId: string | null) {
  if (!economicAssetId) return { netUsd: 0, revenueUsd: 0, expenseUsd: 0 };

  const [revenue, expense] = await Promise.all([
    db.economicRevenue.aggregate({
      where: { assetId: economicAssetId, provenance: { in: [...POLICY_CONSUMING_PROVENANCES] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { assetId: economicAssetId, provenance: { in: [...POLICY_CONSUMING_PROVENANCES] } },
      _sum: { amountCents: true },
    }),
  ]);

  // SIMULATED rows are excluded (the canonical provenance list above). A dry
  // run's pretend profit must never keep a real contract alive, and its pretend
  // loss must never kill one.
  //
  // Summed in integer cents, then converted once: the result is compared
  // against a maximum-loss constraint, and a float sum drifting by a fraction
  // of a cent at exactly that boundary decides whether an experiment lives.
  const revenueCents = revenue._sum.amountCents ?? 0;
  const expenseCents = expense._sum.amountCents ?? 0;
  return {
    netUsd: fromCents(revenueCents - expenseCents),
    revenueUsd: fromCents(revenueCents),
    expenseUsd: fromCents(expenseCents),
  };
}

interface ApplyDecisionInput {
  userId: string;
  experiment: { id: string; hypothesis: string; executionStatus: string };
  subject: string | null;
  contractMaxLossUsd: number;
  result: DecisionResult;
  actual: { netUsd: number; revenueUsd: number; expenseUsd: number };
  now: Date;
}

/**
 * Turns a decision into the state change VOX is actually able to make.
 *
 * The `applied` field is the honesty check: it says what happened, not what
 * was decided. A SCALE that VOX cannot perform is applied as AWAITING_HUMAN,
 * and that is what the audit trail will say forever.
 */
async function applyDecision(input: ApplyDecisionInput): Promise<ExperimentDecisionRecord> {
  const { userId, experiment, result, actual, now } = input;
  const reason = summarize(result.reasons);

  const base = { lastDecision: result.decision, lastDecisionReason: reason, lastDecisionAt: now };
  let applied: ExperimentDecisionRecord["applied"] = "NONE";

  if (result.decision === "KILL") {
    // ORDER MATTERS. The lesson is written BEFORE the experiment is marked
    // terminal. If the process dies between the two, the next tick still sees a
    // live experiment, re-decides it identically (decide() is pure), and the
    // lesson write is idempotent — so neither the lesson nor the kill is lost.
    // The reverse order loses the lesson forever, because a KILLED experiment
    // is never re-evaluated.
    await recordExperimentLesson({
      userId,
      experimentId: experiment.id,
      hypothesis: experiment.hypothesis,
      decision: "KILL",
      bindingConstraint: result.bindingConstraint,
      netUsd: actual.netUsd,
      revenueUsd: actual.revenueUsd,
      expenseUsd: actual.expenseUsd,
      maxLossUsd: input.contractMaxLossUsd,
      subject: input.subject,
    });

    // Applied automatically: stopping requires no capability VOX lacks, and a
    // contract past its loss cap must not wait on a human to stop bleeding.
    await db.experiment.update({
      where: { id: experiment.id },
      data: {
        ...base,
        executionStatus: "KILLED",
        outcome: "KILLED_BY_CONSTRAINT",
        status: "ABANDONED",
        endedAt: now,
      },
    });
    applied = "KILLED";
  } else if (result.decision === "SCALE") {
    // THE BOUNDARY. VOX has no payment, purchasing or deployment capability,
    // so scaling cannot be performed. Stopping here — visibly — is the whole
    // point; recording it as executed would corrupt every number downstream.
    await db.experiment.update({
      where: { id: experiment.id },
      data: { ...base, executionStatus: "AWAITING_HUMAN" },
    });
    applied = "AWAITING_HUMAN";

    await recordEvent({
      userId,
      type: "economic_experiment.scale_blocked",
      subjectType: "Experiment",
      subjectId: experiment.id,
      consequential: true,
      payload: {
        decision: "SCALE",
        bindingConstraint: result.bindingConstraint,
        netUsd: actual.netUsd,
        blockedBy:
          "No external execution capability is configured. VOX cannot deploy capital, purchase, or transact; " +
          "a human must act on this decision.",
      },
    });
  } else {
    // HOLD: the contract keeps running. READY becomes RUNNING on its first
    // evaluation, so "armed" and "being evaluated" stay distinguishable.
    await db.experiment.update({
      where: { id: experiment.id },
      data: { ...base, executionStatus: "RUNNING", status: "RUNNING", startedAt: undefined },
    });
  }

  await recordEvent({
    userId,
    type: "economic_experiment.decided",
    subjectType: "Experiment",
    subjectId: experiment.id,
    consequential: result.decision !== "HOLD",
    payload: {
      decision: result.decision,
      bindingConstraint: result.bindingConstraint,
      reason,
      netUsd: actual.netUsd,
      applied,
    },
  });

  return {
    experimentId: experiment.id,
    decision: result.decision,
    bindingConstraint: result.bindingConstraint,
    netUsd: actual.netUsd,
    applied,
  };
}

function parseDecisions(raw: string | null): ExperimentDecisionRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExperimentDecisionRecord[]) : [];
  } catch {
    return [];
  }
}

/** The most recent ticks, newest first — the loop's own run history. */
export async function listEconomicTicks(userId: string, limit = 20) {
  return db.economicTick.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: limit });
}
