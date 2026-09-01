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
// IDEMPOTENCY. The tick key is a deterministic time bucket and
// EconomicTick has @@unique([userId, tickKey]). A double-fired cron, a retried
// HTTP request or two racing containers produce ONE tick row; the loser gets a
// unique-constraint violation and returns the existing tick untouched. The
// guarantee lives in the database, not in a lock this process holds.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { decide, type DecisionResult, type EconomicDecision } from "@/lib/economic/decide";
import { toDecisionContract } from "@/lib/economic/experiments";
import { getHaltState } from "@/lib/economic/halt";
import { recordExperimentLesson } from "@/lib/economic/lessons";
import type { EconomicTickStatus } from "@/generated/prisma/enums";

/**
 * Tick granularity. Ticks are bucketed to the hour: an economic experiment's
 * measurable state changes when money moves, not when a clock advances, so
 * evaluating more often produces identical answers and more rows.
 */
export const TICK_BUCKET_MS = 60 * 60 * 1000;

/** The deterministic bucket key. Same hour in, same key out, on any machine. */
export function tickKeyFor(now: Date): string {
  return new Date(Math.floor(now.getTime() / TICK_BUCKET_MS) * TICK_BUCKET_MS).toISOString();
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

/**
 * Runs one tick of the economic loop.
 *
 * Safe to call more than once for the same bucket: the second call returns the
 * first call's result with `performed: false` and changes nothing.
 */
export async function runEconomicTick(userId: string, now: Date = new Date()): Promise<EconomicTickResult> {
  const tickKey = tickKeyFor(now);

  const existing = await db.economicTick.findUnique({ where: { userId_tickKey: { userId, tickKey } } });
  if (existing) {
    return {
      tickId: existing.id,
      tickKey,
      status: existing.status,
      performed: false,
      evaluated: existing.evaluatedCount,
      scaled: existing.scaleCount,
      held: existing.holdCount,
      killed: existing.killCount,
      decisions: parseDecisions(existing.decisions),
      note: existing.note,
    };
  }

  // Claim the bucket BEFORE doing any work. If two callers race, exactly one
  // insert survives; the loser re-reads and reports the winner's tick rather
  // than evaluating the same contracts a second time.
  let tick;
  try {
    tick = await db.economicTick.create({ data: { userId, tickKey, status: "COMPLETED" } });
  } catch {
    const winner = await db.economicTick.findUnique({ where: { userId_tickKey: { userId, tickKey } } });
    if (!winner) throw new Error(`Economic tick ${tickKey} could not be claimed and no existing tick was found.`);
    return {
      tickId: winner.id,
      tickKey,
      status: winner.status,
      performed: false,
      evaluated: winner.evaluatedCount,
      scaled: winner.scaleCount,
      held: winner.holdCount,
      killed: winner.killCount,
      decisions: parseDecisions(winner.decisions),
      note: winner.note,
    };
  }

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
      where: { assetId: economicAssetId, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountUsd: true },
    }),
    db.economicExpense.aggregate({
      where: { assetId: economicAssetId, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountUsd: true },
    }),
  ]);

  // SIMULATED rows are excluded. A dry run's pretend profit must never keep a
  // real contract alive, and its pretend loss must never kill one.
  const revenueUsd = revenue._sum.amountUsd ?? 0;
  const expenseUsd = expense._sum.amountUsd ?? 0;
  return { netUsd: revenueUsd - expenseUsd, revenueUsd, expenseUsd };
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

    // The loop's return edge: a concluded experiment becomes a memory, which
    // the next opportunity's evaluation can retrieve by relevance.
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
