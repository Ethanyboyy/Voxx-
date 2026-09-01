import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  getPnlReport,
  getExperimentLedger,
  DAILY_NET_PROFIT_FLOOR_USD,
  MONTHLY_NET_PROFIT_OBJECTIVE_USD,
} from "@/lib/economic/pnl";
import { createTestUser } from "./helpers";

/**
 * The claim these tests defend: a projection can never be reported as profit,
 * and a number VOX cannot know is never rendered as a number.
 */

let userId: string;
let assetId: string;

const NOW = new Date("2026-09-01T12:00:00Z");

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
  const asset = await db.economicAsset.create({
    data: { userId, name: "Test venture", category: "OTHER", status: "OPERATING" },
  });
  assetId = asset.id;
});

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("getPnlReport", () => {
  it("reports honest zeros with no ledger at all", async () => {
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.lifetime.recorded.netUsd).toBe(0);
    expect(pnl.today.recorded.netUsd).toBe(0);
    expect(pnl.lifetime.recorded.entryCount).toBe(0);
  });

  it("separates realized from user-recorded, and never blends them", async () => {
    await db.economicRevenue.create({
      data: { assetId, amountUsd: 100, occurredAt: NOW, provenance: "USER_RECORDED" },
    });
    await db.economicRevenue.create({ data: { assetId, amountUsd: 40, occurredAt: NOW, provenance: "REALIZED" } });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.today.realized.revenueUsd).toBe(40);
    expect(pnl.today.byProvenance.USER_RECORDED.revenueUsd).toBe(100);
    // `recorded` is the union of the two — the strongest available claim.
    expect(pnl.today.recorded.revenueUsd).toBe(140);
  });

  it("never counts a simulated row as money", async () => {
    await db.economicRevenue.create({
      data: { assetId, amountUsd: 10_000, occurredAt: NOW, provenance: "SIMULATED" },
    });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.today.recorded.netUsd).toBe(0);
    expect(pnl.today.realized.netUsd).toBe(0);
    // Visible as a dry run rather than discarded.
    expect(pnl.today.simulated.revenueUsd).toBe(10_000);
    // And it must not close the gap to the floor.
    expect(pnl.floor.recorded.shortfallUsd).toBe(DAILY_NET_PROFIT_FLOOR_USD);
  });

  it("keeps projections in a separate field that is never summed into profit", async () => {
    await db.experiment.create({
      data: {
        userId,
        hypothesis: "A projection is not profit",
        executionStatus: "RUNNING",
        expectedReturnUsd: 50_000,
        expectedNetProfitUsd: 30_000,
        requiredCapitalUsd: 2_000,
        maxLossUsd: 500,
      },
    });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.outlook.kind).toBe("PROJECTED");
    expect(pnl.outlook.expectedNetProfitUsd).toBe(30_000);
    // The measured side is untouched by the forecast.
    expect(pnl.lifetime.recorded.netUsd).toBe(0);
    expect(pnl.today.recorded.netUsd).toBe(0);
    expect(pnl.objective.recorded.actualUsd).toBe(0);
  });

  it("windows by occurredAt — today, 7 days, 30 days and lifetime disagree only where they should", async () => {
    await db.economicRevenue.create({ data: { assetId, amountUsd: 10, occurredAt: NOW } });
    await db.economicRevenue.create({ data: { assetId, amountUsd: 20, occurredAt: daysAgo(3) } });
    await db.economicRevenue.create({ data: { assetId, amountUsd: 40, occurredAt: daysAgo(20) } });
    await db.economicRevenue.create({ data: { assetId, amountUsd: 80, occurredAt: daysAgo(200) } });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.today.recorded.revenueUsd).toBe(10);
    expect(pnl.trailing7d.recorded.revenueUsd).toBe(30);
    expect(pnl.trailing30d.recorded.revenueUsd).toBe(70);
    expect(pnl.lifetime.recorded.revenueUsd).toBe(150);
  });

  it("subtracts expenses in every window", async () => {
    await db.economicRevenue.create({ data: { assetId, amountUsd: 900, occurredAt: NOW } });
    await db.economicExpense.create({ data: { assetId, amountUsd: 250, occurredAt: NOW } });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.today.recorded.netUsd).toBe(650);
    expect(pnl.floor.recorded.met).toBe(true);
    expect(pnl.floor.recorded.surplusUsd).toBe(150);
    expect(pnl.floor.recorded.shortfallUsd).toBe(0);
  });

  it("measures the floor and the objective against the right windows", async () => {
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.floor.targetUsd).toBe(DAILY_NET_PROFIT_FLOOR_USD);
    expect(pnl.floor.periodDays).toBe(1);
    expect(pnl.objective.targetUsd).toBe(MONTHLY_NET_PROFIT_OBJECTIVE_USD);
    expect(pnl.objective.periodDays).toBe(30);
    expect(pnl.objective.recorded.shortfallUsd).toBe(MONTHLY_NET_PROFIT_OBJECTIVE_USD);
  });

  it("reports realized distance separately, and it stays the full target while nothing is verified", async () => {
    await db.economicRevenue.create({
      data: { assetId, amountUsd: 800, occurredAt: NOW, provenance: "USER_RECORDED" },
    });
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.floor.recorded.met).toBe(true);
    // Nothing has been externally confirmed, so the realized measure is honest
    // about that rather than borrowing the recorded number.
    expect(pnl.floor.realized.met).toBe(false);
    expect(pnl.floor.realized.shortfallUsd).toBe(DAILY_NET_PROFIT_FLOOR_USD);
  });

  it("never invents a capital balance", async () => {
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.capital.availableUsd).toBeNull();
    expect(pnl.capital.basis).toBe("NONE");
    expect(pnl.capital.reason).toContain("no connected account balance");
    // The spend ceiling is reported, but as policy — not as cash.
    expect(pnl.capital.policyCeilingUsd).toBe(0);
  });

  it("does not let a simulated expense consume the real spend ceiling", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 500 } });
    await db.economicExpense.create({
      data: { assetId, amountUsd: 400, occurredAt: NOW, provenance: "SIMULATED" },
    });
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.capital.policyRemainingUsd).toBe(500);
  });

  it("scopes to the user — another account's ledger never appears", async () => {
    const other = await createTestUser();
    const otherAsset = await db.economicAsset.create({
      data: { userId: other.id, name: "Theirs", category: "OTHER" },
    });
    await db.economicRevenue.create({ data: { assetId: otherAsset.id, amountUsd: 9_999, occurredAt: NOW } });

    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.lifetime.recorded.revenueUsd).toBe(0);
  });

  it("reports the halt state so the UI cannot show a running engine while it is stopped", async () => {
    await db.user.update({
      where: { id: userId },
      data: { economicHaltedAt: NOW, economicHaltReason: "manual stop" },
    });
    const pnl = await getPnlReport(userId, NOW);
    expect(pnl.capital.halted).toBe(true);
    expect(pnl.capital.haltReason).toBe("manual stop");
  });
});

describe("getExperimentLedger", () => {
  it("returns real zeros for an experiment with no asset", async () => {
    const experiment = await db.experiment.create({ data: { userId, hypothesis: "untested" } });
    const ledger = await getExperimentLedger(userId, experiment.id, NOW);
    expect(ledger.recorded.netUsd).toBe(0);
    expect(ledger.recorded.entryCount).toBe(0);
  });

  it("reads only its own asset's rows", async () => {
    const otherAsset = await db.economicAsset.create({
      data: { userId, name: "Unrelated", category: "OTHER" },
    });
    await db.economicRevenue.create({ data: { assetId: otherAsset.id, amountUsd: 500, occurredAt: NOW } });
    await db.economicRevenue.create({ data: { assetId, amountUsd: 70, occurredAt: NOW } });
    await db.economicExpense.create({ data: { assetId, amountUsd: 20, occurredAt: NOW } });

    const experiment = await db.experiment.create({
      data: { userId, hypothesis: "scoped", economicAssetId: assetId },
    });
    const ledger = await getExperimentLedger(userId, experiment.id, NOW);
    expect(ledger.recorded.netUsd).toBe(50);
  });
});
