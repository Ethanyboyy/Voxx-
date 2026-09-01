import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { runEconomicTick, tickKeyFor } from "@/lib/economic/scheduler";
import { haltEconomicEngine, resumeEconomicEngine, getHaltState, EconomicHaltedError } from "@/lib/economic/halt";
import { evaluateSpendPolicy } from "@/lib/economic/policy";
import { recordOpportunitySpend } from "@/lib/economic/service";
import { ECONOMIC_LESSON_PROVENANCE, getRelevantLessons } from "@/lib/economic/lessons";
import { listMemoriesByProvenance } from "@/lib/memory/service";
import { createTestUser, seedLedgerEntry } from "./helpers";

/**
 * The control loop and the stop button.
 *
 * Two properties are load-bearing here. First, the halt must be real: it has
 * to hold in service code, at every point money or execution can start, not
 * merely hide a button. Second, the scheduler must be honest about the
 * boundary — VOX cannot transact, so a SCALE decision must never be recorded
 * as though something was executed.
 */

let userId: string;
let assetId: string;
let opportunityId: string;

const NOW = new Date("2026-09-01T12:00:00Z");

const CONTRACT = {
  hypothesis: "A bounded paid test returns above cost",
  requiredCapitalUsd: 100,
  maxLossUsd: 200,
  successMetric: "net above $500",
  failureMetric: "net below -$150",
  deadlineAt: new Date("2026-12-01T00:00:00Z"),
  scaleCriteria: "net above $500",
  scaleAtNetUsd: 500,
  killCriteria: "net at or below -$150",
  killAtNetUsd: -150,
  expectedReturnUsd: 900,
  expectedNetProfitUsd: 700,
  requiredCapabilities: "[]",
};

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
  const objective = await db.objective.create({ data: { userId, title: "Reach the daily floor" } });
  const opportunity = await db.opportunity.create({
    data: { userId, objectiveId: objective.id, title: "Paid acquisition test" },
  });
  opportunityId = opportunity.id;
  const asset = await db.economicAsset.create({
    data: { userId, name: "Paid acquisition test", category: "OTHER", status: "OPERATING" },
  });
  assetId = asset.id;
});

async function liveExperiment(overrides: Record<string, unknown> = {}) {
  return db.experiment.create({
    data: { userId, ...CONTRACT, economicAssetId: assetId, executionStatus: "READY", ...overrides },
  });
}

describe("the global economic halt is enforced in service code", () => {
  it("denies every autonomous spend, however small", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 1000 } });
    expect((await evaluateSpendPolicy(userId, 1)).allowed).toBe(true);

    await haltEconomicEngine(userId, "test stop");

    // A halt that only stops large spends is not a halt.
    for (const amount of [0.01, 1, 999]) {
      const decision = await evaluateSpendPolicy(userId, amount);
      expect(decision.allowed, `$${amount}`).toBe(false);
      expect(decision.halted).toBe(true);
    }
  });

  it("throws at the point money is actually recorded, not only at the front door", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 1000 } });
    await haltEconomicEngine(userId, "test stop");
    await expect(recordOpportunitySpend(userId, { opportunityId, amountUsd: 5 })).rejects.toThrow(EconomicHaltedError);
    // And nothing was written.
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(0);
  });

  it("stops the scheduler from evaluating anything at all", async () => {
    await liveExperiment();
    await haltEconomicEngine(userId, "test stop");

    const tick = await runEconomicTick(userId, NOW);
    expect(tick.status).toBe("HALTED");
    expect(tick.evaluated).toBe(0);
    expect(tick.decisions).toHaveLength(0);
    expect(tick.note).toContain("halt");
  });

  it("is idempotent, and keeps the original reason when pressed twice", async () => {
    const first = await haltEconomicEngine(userId, "first reason");
    const second = await haltEconomicEngine(userId, "second reason");
    expect(second.reason).toBe("first reason");
    expect(second.haltedAt?.toISOString()).toBe(first.haltedAt?.toISOString());
  });

  it("records consequential Events for both halting and resuming", async () => {
    await haltEconomicEngine(userId, "test stop");
    await resumeEconomicEngine(userId);
    const events = await db.event.findMany({ where: { userId, type: { in: ["economic.halted", "economic.resumed"] } } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.consequential)).toBe(true);
    expect((await getHaltState(userId)).halted).toBe(false);
  });
});

describe("runEconomicTick idempotency", () => {
  it("evaluates a bucket exactly once, no matter how many times it is called", async () => {
    await liveExperiment();

    const first = await runEconomicTick(userId, NOW);
    const second = await runEconomicTick(userId, NOW);
    const third = await runEconomicTick(userId, new Date(NOW.getTime() + 60_000)); // same hour

    expect(first.performed).toBe(true);
    expect(second.performed).toBe(false);
    expect(third.performed).toBe(false);
    expect(second.tickId).toBe(first.tickId);
    expect(await db.economicTick.count({ where: { userId } })).toBe(1);
  });

  it("runs again in the next bucket", async () => {
    await liveExperiment();
    await runEconomicTick(userId, NOW);
    const next = await runEconomicTick(userId, new Date(NOW.getTime() + 60 * 60 * 1000));
    expect(next.performed).toBe(true);
    expect(await db.economicTick.count({ where: { userId } })).toBe(2);
  });

  it("derives the same bucket key from any instant inside the hour", () => {
    expect(tickKeyFor(new Date("2026-09-01T12:00:00Z"))).toBe(tickKeyFor(new Date("2026-09-01T12:59:59Z")));
    expect(tickKeyFor(new Date("2026-09-01T12:00:00Z"))).not.toBe(tickKeyFor(new Date("2026-09-01T13:00:00Z")));
  });
});

describe("the tick stops at the execution boundary instead of pretending", () => {
  it("does not report a SCALE as executed — it parks it for a human", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 1000 } });
    const experiment = await liveExperiment();
    await seedLedgerEntry("revenue", { assetId, amountUsd: 900, occurredAt: NOW });
    await seedLedgerEntry("expense", { assetId, amountUsd: 100, occurredAt: NOW });

    const tick = await runEconomicTick(userId, NOW);
    expect(tick.scaled).toBe(1);
    expect(tick.decisions[0].decision).toBe("SCALE");
    // The honesty check: what was DECIDED vs what was DONE.
    expect(tick.decisions[0].applied).toBe("AWAITING_HUMAN");

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("AWAITING_HUMAN");

    const blocked = await db.event.findFirst({
      where: { userId, type: "economic_experiment.scale_blocked", subjectId: experiment.id },
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.payload).toContain("No external execution capability");
  });

  it("applies a KILL automatically, because stopping needs no capability VOX lacks", async () => {
    const experiment = await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });

    const tick = await runEconomicTick(userId, NOW);
    expect(tick.killed).toBe(1);
    expect(tick.decisions[0].applied).toBe("KILLED");

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("KILLED");
    expect(after.outcome).toBe("KILLED_BY_CONSTRAINT");
    expect(after.lastDecision).toBe("KILL");
    expect(after.lastDecisionReason).toContain("$200.00");
  });

  it("holds a contract inside every bound and never spends anything", async () => {
    const experiment = await liveExperiment();
    const tick = await runEconomicTick(userId, NOW);
    expect(tick.held).toBe(1);
    expect(tick.decisions[0].decision).toBe("HOLD");
    expect(tick.decisions[0].applied).toBe("NONE");

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("RUNNING");
    // The scheduler is a decision layer. It moves no money.
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(0);
  });

  it("parks a live experiment whose contract stopped being executable rather than guessing", async () => {
    const experiment = await liveExperiment({ maxLossUsd: null });
    const tick = await runEconomicTick(userId, NOW);
    expect(tick.decisions[0].bindingConstraint).toBe("CONTRACT_NOT_EXECUTABLE");

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("AWAITING_HUMAN");
  });

  it("never re-decides a terminal experiment", async () => {
    await liveExperiment({ executionStatus: "KILLED" });
    const tick = await runEconomicTick(userId, NOW);
    expect(tick.evaluated).toBe(0);
  });

  it("ignores simulated ledger rows when measuring a contract", async () => {
    // A dry run's pretend profit must not keep a real contract alive, and its
    // pretend loss must not kill one.
    const experiment = await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 5_000, occurredAt: NOW, provenance: "SIMULATED" });
    await runEconomicTick(userId, NOW);
    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("RUNNING");
  });

  it("records every decision as an Event", async () => {
    await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });
    await runEconomicTick(userId, NOW);

    const decided = await db.event.findFirst({ where: { userId, type: "economic_experiment.decided" } });
    expect(decided).not.toBeNull();
    expect(decided!.consequential).toBe(true);
    const completed = await db.event.findFirst({ where: { userId, type: "economic_tick.completed" } });
    expect(completed).not.toBeNull();
  });
});

describe("outcome -> memory -> future evaluation", () => {
  it("writes a measured lesson when a contract is killed", async () => {
    await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });
    await runEconomicTick(userId, NOW);

    const lessons = await listMemoriesByProvenance(userId, [ECONOMIC_LESSON_PROVENANCE]);
    expect(lessons).toHaveLength(1);
    // The measurement, with its real numbers — not a verdict about a market.
    expect(lessons[0].content).toContain("net $-300.00");
    expect(lessons[0].content).toContain(CONTRACT.hypothesis);
    expect(lessons[0].category).toBe("FACT");
  });

  it("retrieves a lesson by relevance, and returns nothing for an unrelated query", async () => {
    await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });
    await runEconomicTick(userId, NOW);

    const related = await getRelevantLessons(userId, CONTRACT.hypothesis);
    expect(related.length).toBeGreaterThan(0);
    expect(related[0].similarity).toBeGreaterThanOrEqual(0.35);

    // Not blind injection: an unrelated idea must not drag the lesson along.
    const unrelated = await getRelevantLessons(userId, "zzzz qqqq xxxx vvvv");
    expect(unrelated).toHaveLength(0);
  });

  it("scopes lessons to the user", async () => {
    await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });
    await runEconomicTick(userId, NOW);

    const other = await createTestUser();
    expect(await getRelevantLessons(other.id, CONTRACT.hypothesis)).toHaveLength(0);
  });
});
