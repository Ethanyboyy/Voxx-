import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { toCents, normalizeAmount, InvalidMoneyError, MAX_ENTRY_USD, sumCents } from "@/lib/economic/money";
import { addEconomicExpense, addEconomicRevenue, getBudgetSummary, recordOpportunitySpend } from "@/lib/economic/service";
import { recordPolicySpend, SpendRefusedError } from "@/lib/economic/spend";
import { getPolicySpendPosition, ceilingToCents, consumesPolicyBudget } from "@/lib/economic/accounting";
import { evaluateSpendPolicy } from "@/lib/economic/policy";
import { getPnlReport } from "@/lib/economic/pnl";
import { runEconomicTick, tickKeyFor, TICK_LEASE_MS, MAX_TICK_ATTEMPTS } from "@/lib/economic/scheduler";
import { haltEconomicEngine } from "@/lib/economic/halt";
import { decide, type DecisionContract } from "@/lib/economic/decide";
import { addEconomicLedgerEntrySchema } from "@/lib/validation/schemas";
import { createTestUser, seedLedgerEntry } from "./helpers";

/**
 * Adversarial tests for the economic engine.
 *
 * These are written to BREAK the engine, not to demonstrate it. Each one is a
 * claim about something that must be impossible, and several of them failed
 * before this hardening pass — the ceiling ones most seriously, because the
 * ceiling was not enforced cumulatively anywhere and could be walked past
 * indefinitely in $60 increments.
 *
 * Invariants under test are labelled I1..I8; see ECONOMIC_INVARIANTS.md.
 */

let userId: string;
let assetId: string;
let opportunityId: string;

const NOW = new Date("2026-09-01T12:00:00Z");

/** Every shape of "not money" that has ever reached a ledger somewhere. */
const NOT_MONEY: [string, number][] = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["zero", 0],
  ["negative", -50],
  ["negative cent", -0.01],
  ["absurdly large", 1e308],
  ["just over the cap", MAX_ENTRY_USD + 1],
  ["sub-cent", 0.004],
];

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
  const objective = await db.objective.create({ data: { userId, title: "Objective" } });
  const opportunity = await db.opportunity.create({
    data: { userId, objectiveId: objective.id, title: "Opportunity" },
  });
  opportunityId = opportunity.id;
  const asset = await db.economicAsset.create({
    data: { userId, name: "Asset", category: "OTHER", status: "OPERATING" },
  });
  assetId = asset.id;
});

// ---------------------------------------------------------------------------
// I6 — invalid money can never enter the ledger
// ---------------------------------------------------------------------------

describe("money input hardening (I6)", () => {
  it.each(NOT_MONEY)("toCents rejects %s", (_label, value) => {
    expect(() => toCents(value)).toThrow(InvalidMoneyError);
  });

  it("rejects non-numeric input rather than coercing it", () => {
    for (const value of [null, undefined, "100", {}, [], true]) {
      expect(() => toCents(value)).toThrow(InvalidMoneyError);
    }
  });

  it("checks the cap BEFORE rounding, so 1e308 cannot become Infinity mid-conversion", () => {
    // Math.round(1e308 * 100) is Infinity. Bounding first is what stops an
    // Infinity from ever existing inside the conversion.
    expect(() => toCents(1e308)).toThrow(/at most/);
  });

  it("accepts the exact boundary values", () => {
    expect(toCents(0.01)).toBe(1);
    expect(toCents(MAX_ENTRY_USD)).toBe(MAX_ENTRY_USD * 100);
  });

  it("rounds at the cent without accumulating float error", () => {
    expect(toCents(19.99)).toBe(1999); // CAST would truncate this to 1998
    expect(toCents(0.1) + toCents(0.2)).toBe(30); // 0.1 + 0.2 !== 0.3 in floats
    expect(normalizeAmount(0.615).cents).toBe(62);
  });

  it("sumCents refuses non-integer cents rather than silently drifting", () => {
    expect(() => sumCents([100, 12.5])).toThrow(InvalidMoneyError);
    expect(() => sumCents([100, Number.MAX_SAFE_INTEGER + 10])).toThrow(InvalidMoneyError);
  });

  it.each(NOT_MONEY)("the service boundary rejects %s on an expense", async (_label, value) => {
    await expect(addEconomicExpense(userId, assetId, { amountUsd: value, occurredAt: NOW })).rejects.toThrow(
      InvalidMoneyError
    );
    expect(await db.economicExpense.count({ where: { assetId } })).toBe(0);
  });

  it.each(NOT_MONEY)("the service boundary rejects %s on revenue", async (_label, value) => {
    await expect(addEconomicRevenue(userId, assetId, { amountUsd: value, occurredAt: NOW })).rejects.toThrow(
      InvalidMoneyError
    );
    expect(await db.economicRevenue.count({ where: { assetId } })).toBe(0);
  });

  it("the API schema rejects the same values, independently of the service", () => {
    // Two boundaries, not one. The API schema does not cover service-to-service
    // calls, and the service does not cover a malformed request body's other
    // fields — each has to hold on its own.
    for (const [label, value] of NOT_MONEY) {
      const result = addEconomicLedgerEntrySchema.safeParse({ amountUsd: value, occurredAt: NOW });
      // Sub-cent is a real number the schema accepts; the service is what
      // rejects it as not-a-transaction. Every other shape dies here.
      if (label === "sub-cent") continue;
      expect(result.success, `${label} should be rejected by the API schema`).toBe(false);
    }
  });

  it("a valid write keeps amountUsd and amountCents in exact agreement", async () => {
    const row = await addEconomicExpense(userId, assetId, { amountUsd: 19.99, occurredAt: NOW });
    expect(row!.amountCents).toBe(1999);
    expect(row!.amountUsd).toBe(19.99);
    expect(Math.round(row!.amountUsd * 100)).toBe(row!.amountCents);
  });

  it("P&L stays finite and exact after many awkward amounts (I6)", async () => {
    for (let i = 0; i < 60; i++) {
      await seedLedgerEntry("revenue", { assetId, amountUsd: 0.07, occurredAt: NOW });
    }
    const pnl = await getPnlReport(userId, NOW);
    // 60 x $0.07 = $4.20 exactly. A float accumulation lands on 4.199999...
    expect(pnl.today.recorded.revenueCents).toBe(420);
    expect(pnl.today.recorded.revenueUsd).toBe(4.2);
    expect(Number.isFinite(pnl.today.recorded.netUsd)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I4 — the spend ceiling cannot be exceeded, sequentially or concurrently
// ---------------------------------------------------------------------------

describe("spend ceiling enforcement (I4)", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
  });

  it("REGRESSION: repeated under-ceiling spends cannot walk past the ceiling", async () => {
    // The original bug. evaluateSpendPolicy compared ONE amount to the ceiling
    // and never consulted cumulative spend, so $60 + $60 + $60 against a $100
    // ceiling all passed. This is the test that would have caught it.
    await recordPolicySpend(userId, { assetId, amountUsd: 60 });
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 60 })).rejects.toThrow(SpendRefusedError);

    const position = await getPolicySpendPosition(userId);
    expect(position.spentCents).toBe(6000);
    expect(position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
  });

  it("CONCURRENCY: two simultaneous $60 spends against a $100 ceiling — only one lands", async () => {
    const results = await Promise.allSettled([
      recordPolicySpend(userId, { assetId, amountUsd: 60 }),
      recordPolicySpend(userId, { assetId, amountUsd: 60 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const position = await getPolicySpendPosition(userId);
    expect(position.spentCents).toBe(6000);
    // The invariant, stated directly: final state is within policy.
    expect(position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(1);
  });

  it("CONCURRENCY: ten simultaneous $20 spends against a $100 ceiling — exactly five land", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => recordPolicySpend(userId, { assetId, amountUsd: 20 }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);

    const position = await getPolicySpendPosition(userId);
    expect(position.spentCents).toBe(10_000);
    expect(position.remainingCents).toBe(0);
  });

  it("permits spending exactly to the ceiling, and not one cent beyond", async () => {
    await recordPolicySpend(userId, { assetId, amountUsd: 99.99 });
    await recordPolicySpend(userId, { assetId, amountUsd: 0.01 });
    const position = await getPolicySpendPosition(userId);
    expect(position.spentCents).toBe(10_000);

    await expect(recordPolicySpend(userId, { assetId, amountUsd: 0.01 })).rejects.toThrow(/above the ceiling/);
  });

  it("refuses everything when the ceiling is zero (the default)", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 0 } });
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 0.01 })).rejects.toThrow(SpendRefusedError);
  });

  it("fails closed on a corrupted non-finite ceiling rather than permitting everything", () => {
    // NaN would make `spent + amount <= NaN` false, but `ceiling - spent`
    // meaningless. Collapsing to 0 denies, which is the only safe direction.
    expect(ceilingToCents(NaN)).toBe(0);
    expect(ceilingToCents(Infinity)).toBe(0);
    expect(ceilingToCents(-100)).toBe(0);
  });

  it("rejects an invalid amount before it reaches the SQL guard", async () => {
    for (const [, value] of NOT_MONEY) {
      await expect(recordPolicySpend(userId, { assetId, amountUsd: value })).rejects.toThrow(InvalidMoneyError);
    }
    expect(await db.economicExpense.count({ where: { assetId } })).toBe(0);
  });

  it("cannot spend against another user's asset", async () => {
    const other = await createTestUser();
    const theirAsset = await db.economicAsset.create({
      data: { userId: other.id, name: "Theirs", category: "OTHER" },
    });
    await expect(recordPolicySpend(userId, { assetId: theirAsset.id, amountUsd: 1 })).rejects.toThrow(
      SpendRefusedError
    );
    expect(await db.economicExpense.count({ where: { assetId: theirAsset.id } })).toBe(0);
  });

  it("the pre-flight policy check agrees with what the guard actually does", async () => {
    await recordPolicySpend(userId, { assetId, amountUsd: 90 });
    const decision = await evaluateSpendPolicy(userId, 20);
    expect(decision.allowed).toBe(false);
    expect(decision.alreadySpentUsd).toBe(90);
    expect(decision.remainingUsd).toBe(10);
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 20 })).rejects.toThrow(SpendRefusedError);
  });

  it("evaluateSpendPolicy refuses non-finite amounts instead of comparing them", async () => {
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
      const decision = await evaluateSpendPolicy(userId, value);
      expect(decision.allowed, String(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// I2 — SIMULATED never consumes real budget
// ---------------------------------------------------------------------------

describe("simulated ledger contamination (I2)", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
  });

  it("a large simulated expense consumes no policy budget at all", async () => {
    await seedLedgerEntry("expense", { assetId, amountUsd: 10_000, occurredAt: NOW, provenance: "SIMULATED" });

    const position = await getPolicySpendPosition(userId);
    expect(position.spentCents).toBe(0);
    expect(position.remainingCents).toBe(10_000);
    expect(position.simulatedCents).toBe(1_000_000);

    // And a real spend still succeeds afterwards.
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 100 })).resolves.toBeDefined();
  });

  it("an autonomous spend is always USER_RECORDED — SIMULATED is not a reachable bypass", async () => {
    const expense = await recordPolicySpend(userId, { assetId, amountUsd: 10 });
    expect(expense.provenance).toBe("USER_RECORDED");
    expect(consumesPolicyBudget(expense.provenance)).toBe(true);
  });

  it("simulated rows never move the floor or the objective", async () => {
    await seedLedgerEntry("revenue", { assetId, amountUsd: 50_000, occurredAt: NOW, provenance: "SIMULATED" });
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.floor.recorded.met).toBe(false);
    expect(pnl.floor.recorded.actualUsd).toBe(0);
    expect(pnl.objective.recorded.actualUsd).toBe(0);
  });

  it("simulated rows never keep a losing contract alive", async () => {
    const experiment = await db.experiment.create({
      data: {
        userId,
        hypothesis: "simulated profit must not rescue this",
        economicAssetId: assetId,
        executionStatus: "READY",
        requiredCapitalUsd: 100,
        maxLossUsd: 200,
        successMetric: "x",
        failureMetric: "y",
        deadlineAt: new Date("2026-12-01T00:00:00Z"),
        scaleCriteria: "x",
        scaleAtNetUsd: 500,
        killCriteria: "y",
        killAtNetUsd: -150,
        expectedReturnUsd: 900,
        expectedNetProfitUsd: 700,
        requiredCapabilities: "[]",
      },
    });
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });
    await seedLedgerEntry("revenue", { assetId, amountUsd: 99_999, occurredAt: NOW, provenance: "SIMULATED" });

    await runEconomicTick(userId, NOW);
    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("KILLED");
  });
});

// ---------------------------------------------------------------------------
// I1 — REALIZED is unreachable through ordinary writes
// ---------------------------------------------------------------------------

describe("attempted REALIZED injection (I1)", () => {
  it("REJECTS a cast that tries to write REALIZED through the ordinary API", async () => {
    // The Exclude<> on the input type stops honest TypeScript callers and
    // nothing else. This is the runtime guard: a cast, a widened JSON payload,
    // or a JS caller all hit the same refusal.
    await expect(
      addEconomicExpense(userId, assetId, { amountUsd: 10, occurredAt: NOW, provenance: "REALIZED" as never })
    ).rejects.toThrow(/REALIZED provenance cannot be written/);
    await expect(
      addEconomicRevenue(userId, assetId, { amountUsd: 10, occurredAt: NOW, provenance: "REALIZED" as never })
    ).rejects.toThrow(/REALIZED provenance cannot be written/);

    expect(await db.economicExpense.count({ where: { assetId } })).toBe(0);
    expect(await db.economicRevenue.count({ where: { assetId } })).toBe(0);
  });

  it("the API schema has no provenance field, so a request body cannot carry one", () => {
    const parsed = addEconomicLedgerEntrySchema.safeParse({
      amountUsd: 10,
      occurredAt: NOW,
      provenance: "REALIZED",
    });
    // Parsed successfully, but the key is stripped rather than honoured.
    expect(parsed.success && "provenance" in parsed.data).toBe(false);
  });

  it("the autonomous spend path hardcodes USER_RECORDED and takes no provenance argument", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
    const expense = await recordPolicySpend(userId, { assetId, amountUsd: 5 });
    expect(expense.provenance).toBe("USER_RECORDED");
  });

  it("realized profit stays zero while nothing external has confirmed anything", async () => {
    await seedLedgerEntry("revenue", { assetId, amountUsd: 5_000, occurredAt: NOW, provenance: "USER_RECORDED" });
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.today.realized.netUsd).toBe(0);
    expect(pnl.floor.realized.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I3 — the halt is authoritative at every boundary
// ---------------------------------------------------------------------------

describe("global halt (I3)", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 1000 } });
  });

  it("blocks the atomic spend boundary itself, not just the pre-flight check", async () => {
    await haltEconomicEngine(userId, "adversarial stop");
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 1 })).rejects.toThrow(SpendRefusedError);
    await expect(recordPolicySpend(userId, { assetId, amountUsd: 1 })).rejects.toThrow(/halt/i);
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(0);
  });

  it("HALT + CONCURRENCY: a halt engaged alongside a burst of spends lets none of them through", async () => {
    await haltEconomicEngine(userId, "adversarial stop");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => recordPolicySpend(userId, { assetId, amountUsd: 1 }))
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(0);
  });

  it("blocks the opportunity spend path", async () => {
    await haltEconomicEngine(userId, "adversarial stop");
    await expect(recordOpportunitySpend(userId, { opportunityId, amountUsd: 1 })).rejects.toThrow();
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(0);
  });

  it("can never produce a SCALE decision, at any net", () => {
    const contract: DecisionContract = {
      experimentId: "x",
      maxLossUsd: 1_000_000,
      requiredCapitalUsd: 0,
      scaleAtNetUsd: 0,
      killAtNetUsd: -999_999,
      deadlineAt: new Date("2099-01-01T00:00:00Z"),
    };
    for (const netUsd of [0, 1, 1e6, 1e12]) {
      const result = decide({
        contract,
        actual: { netUsd, revenueUsd: netUsd, expenseUsd: 0 },
        now: NOW,
        halted: true,
        policyCeilingUsd: 1e9,
      });
      expect(result.decision, `net ${netUsd}`).not.toBe("SCALE");
    }
  });
});

// ---------------------------------------------------------------------------
// I5 — a failed tick is never lost
// ---------------------------------------------------------------------------

describe("scheduler lifecycle (I5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function liveExperiment() {
    return db.experiment.create({
      data: {
        userId,
        hypothesis: "a bounded test",
        economicAssetId: assetId,
        executionStatus: "READY",
        requiredCapitalUsd: 100,
        maxLossUsd: 200,
        successMetric: "x",
        failureMetric: "y",
        deadlineAt: new Date("2026-12-01T00:00:00Z"),
        scaleCriteria: "x",
        scaleAtNetUsd: 500,
        killCriteria: "y",
        killAtNetUsd: -150,
        expectedReturnUsd: 900,
        expectedNetProfitUsd: 700,
        requiredCapabilities: "[]",
      },
    });
  }

  it("a successful tick ends COMPLETED, not before", async () => {
    await liveExperiment();
    const tick = await runEconomicTick(userId, NOW);
    expect(tick.status).toBe("COMPLETED");
    const row = await db.economicTick.findUniqueOrThrow({ where: { id: tick.tickId } });
    expect(row.status).toBe("COMPLETED");
    expect(row.finishedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("REGRESSION: a crash halfway leaves the tick FAILED and reclaimable, never COMPLETED", async () => {
    // The original bug wrote COMPLETED before any work ran, so a crash here
    // left a permanently "successful" tick with zero decisions that the unique
    // constraint made impossible to retry. The tick was lost forever, and the
    // audit trail claimed success.
    await liveExperiment();
    const spy = vi.spyOn(db.experiment, "findMany").mockRejectedValueOnce(new Error("simulated crash"));

    await expect(runEconomicTick(userId, NOW)).rejects.toThrow("simulated crash");
    spy.mockRestore();

    const row = await db.economicTick.findUniqueOrThrow({ where: { userId_tickKey: { userId, tickKey: tickKeyFor(NOW) } } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("simulated crash");
    expect(row.leaseExpiresAt).toBeNull();
  });

  it("retrying after a failure completes the work that was lost", async () => {
    const experiment = await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });

    const spy = vi.spyOn(db.experiment, "findMany").mockRejectedValueOnce(new Error("simulated crash"));
    await expect(runEconomicTick(userId, NOW)).rejects.toThrow();
    spy.mockRestore();

    const retry = await runEconomicTick(userId, NOW);
    expect(retry.performed).toBe(true);
    expect(retry.status).toBe("COMPLETED");
    expect(retry.killed).toBe(1);

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("KILLED");
    // Still exactly one tick row: the retry reclaimed, it did not duplicate.
    expect(await db.economicTick.count({ where: { userId } })).toBe(1);
  });

  it("a retry writes no duplicate lesson", async () => {
    await liveExperiment();
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW });

    const spy = vi.spyOn(db.experiment, "update").mockRejectedValueOnce(new Error("crash after the lesson"));
    await expect(runEconomicTick(userId, NOW)).rejects.toThrow();
    spy.mockRestore();

    await runEconomicTick(userId, NOW);
    const lessons = await db.memory.count({ where: { userId, provenance: "economic.experiment.outcome" } });
    expect(lessons).toBe(1);
  });

  it("a stale IN_PROGRESS claim is reclaimable once its lease expires", async () => {
    await liveExperiment();
    // A worker that claimed the tick and then vanished without releasing it.
    await db.economicTick.create({
      data: {
        userId,
        tickKey: tickKeyFor(NOW),
        status: "IN_PROGRESS",
        attempts: 1,
        leaseExpiresAt: new Date(NOW.getTime() - 1),
      },
    });

    const result = await runEconomicTick(userId, NOW);
    expect(result.performed).toBe(true);
    expect(result.status).toBe("COMPLETED");
    const row = await db.economicTick.findUniqueOrThrow({ where: { id: result.tickId } });
    expect(row.attempts).toBe(2);
  });

  it("a LIVE claim held by another worker is left alone", async () => {
    await liveExperiment();
    await db.economicTick.create({
      data: {
        userId,
        tickKey: tickKeyFor(NOW),
        status: "IN_PROGRESS",
        attempts: 1,
        leaseExpiresAt: new Date(NOW.getTime() + TICK_LEASE_MS),
      },
    });

    const result = await runEconomicTick(userId, NOW);
    expect(result.performed).toBe(false);
    expect(result.evaluated).toBe(0);
    const row = await db.economicTick.findUniqueOrThrow({ where: { id: result.tickId } });
    expect(row.attempts).toBe(1);
  });

  it("stops reclaiming after MAX_TICK_ATTEMPTS rather than looping forever", async () => {
    await liveExperiment();
    await db.economicTick.create({
      data: {
        userId,
        tickKey: tickKeyFor(NOW),
        status: "FAILED",
        attempts: MAX_TICK_ATTEMPTS,
        lastError: "deterministic failure",
        leaseExpiresAt: null,
      },
    });

    const result = await runEconomicTick(userId, NOW);
    expect(result.performed).toBe(false);
    expect(result.note).toContain("abandoned");
  });

  it("CONCURRENCY: simultaneous ticks for the same bucket produce one tick row", async () => {
    await liveExperiment();
    const results = await Promise.all([
      runEconomicTick(userId, NOW),
      runEconomicTick(userId, NOW),
      runEconomicTick(userId, NOW),
    ]);
    expect(results.filter((r) => r.performed)).toHaveLength(1);
    expect(await db.economicTick.count({ where: { userId } })).toBe(1);
    expect(new Set(results.map((r) => r.tickId)).size).toBe(1);
  });

  it("a halted tick is terminal and is not retried", async () => {
    await liveExperiment();
    await haltEconomicEngine(userId, "stop");
    const first = await runEconomicTick(userId, NOW);
    expect(first.status).toBe("HALTED");
    const second = await runEconomicTick(userId, NOW);
    expect(second.performed).toBe(false);
    expect(second.status).toBe("HALTED");
  });
});

// ---------------------------------------------------------------------------
// I8 / I7 — the numbers agree, and SCALE never becomes execution
// ---------------------------------------------------------------------------

describe("canonical accounting agreement (I8)", () => {
  it("the budget panel and the P&L capital posture report identical figures", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 500 } });
    await seedLedgerEntry("expense", { assetId, amountUsd: 120, occurredAt: NOW });
    await seedLedgerEntry("expense", { assetId, amountUsd: 300, occurredAt: NOW, provenance: "SIMULATED" });

    const [budget, pnl, position] = await Promise.all([
      getBudgetSummary(userId),
      getPnlReport(userId, NOW),
      getPolicySpendPosition(userId),
    ]);

    // REGRESSION: getBudgetSummary summed every provenance and the P&L filtered,
    // so these two disagreed by the simulated amount on the same screen.
    expect(budget.totalSpentUsd).toBe(120);
    expect(budget.remainingAutonomousUsd).toBe(380);
    expect(pnl.capital.policyRemainingUsd).toBe(budget.remainingAutonomousUsd);
    expect(pnl.capital.policyCeilingUsd).toBe(budget.maxAutonomousSpendUsd);
    expect(position.remainingUsd).toBe(budget.remainingAutonomousUsd);
    // The dry run is reported, separately, and consumed nothing.
    expect(budget.simulatedSpendUsd).toBe(300);
  });
});

describe("SCALE cannot become automatic execution (I7)", () => {
  it("a contract that scales is parked for a human and moves no money", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 10_000 } });
    const experiment = await db.experiment.create({
      data: {
        userId,
        hypothesis: "a winner",
        economicAssetId: assetId,
        executionStatus: "READY",
        requiredCapitalUsd: 100,
        maxLossUsd: 200,
        successMetric: "x",
        failureMetric: "y",
        deadlineAt: new Date("2026-12-01T00:00:00Z"),
        scaleCriteria: "x",
        scaleAtNetUsd: 500,
        killCriteria: "y",
        killAtNetUsd: -150,
        expectedReturnUsd: 900,
        expectedNetProfitUsd: 700,
        requiredCapabilities: "[]",
      },
    });
    await seedLedgerEntry("revenue", { assetId, amountUsd: 900, occurredAt: NOW });

    const expensesBefore = await db.economicExpense.count({ where: { asset: { userId } } });
    const tick = await runEconomicTick(userId, NOW);

    expect(tick.decisions[0].decision).toBe("SCALE");
    expect(tick.decisions[0].applied).toBe("AWAITING_HUMAN");
    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("AWAITING_HUMAN");
    // Nothing was deployed. A SCALE that spent money would be the whole failure.
    expect(await db.economicExpense.count({ where: { asset: { userId } } })).toBe(expensesBefore);
  });
});

// ---------------------------------------------------------------------------
// Malformed and contradictory contracts
// ---------------------------------------------------------------------------

describe("malformed and stale contracts", () => {
  it("an incomplete contract parks rather than being guessed at", async () => {
    const experiment = await db.experiment.create({
      data: { userId, hypothesis: "half-written", economicAssetId: assetId, executionStatus: "RUNNING", maxLossUsd: 100 },
    });
    const tick = await runEconomicTick(userId, NOW);
    expect(tick.decisions[0].bindingConstraint).toBe("CONTRACT_NOT_EXECUTABLE");
    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("AWAITING_HUMAN");
  });

  it("a stale contract past its deadline without meeting scale is killed, not extended", async () => {
    const experiment = await db.experiment.create({
      data: {
        userId,
        hypothesis: "expired",
        economicAssetId: assetId,
        executionStatus: "READY",
        requiredCapitalUsd: 10,
        maxLossUsd: 200,
        successMetric: "x",
        failureMetric: "y",
        deadlineAt: new Date("2026-01-01T00:00:00Z"),
        scaleCriteria: "x",
        scaleAtNetUsd: 500,
        killCriteria: "y",
        killAtNetUsd: -150,
        expectedReturnUsd: 900,
        expectedNetProfitUsd: 700,
        requiredCapabilities: "[]",
      },
    });
    await seedLedgerEntry("revenue", { assetId, amountUsd: 10, occurredAt: NOW });

    await runEconomicTick(userId, NOW);
    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(after.executionStatus).toBe("KILLED");
    expect(after.lastDecisionReason).toContain("Deadline");
  });

  it("contradictory conditions resolve by hard-constraint precedence, never by chance", () => {
    // Simultaneously: past max loss, past the kill threshold, past the deadline,
    // above the scale threshold, and halted. Exactly one answer is correct.
    const result = decide({
      contract: {
        experimentId: "x",
        maxLossUsd: 100,
        requiredCapitalUsd: 0,
        scaleAtNetUsd: -1000,
        killAtNetUsd: -50,
        deadlineAt: new Date("2020-01-01T00:00:00Z"),
      },
      actual: { netUsd: -500, revenueUsd: 0, expenseUsd: 500 },
      now: NOW,
      halted: true,
      policyCeilingUsd: 1e9,
    });
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });
});
