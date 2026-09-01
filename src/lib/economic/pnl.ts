// Profit and loss, computed from the ledger VOX already has.
//
// WHY THIS EXISTS. getEconomicOverview() answers one question — lifetime
// revenue minus lifetime expense — and answers it correctly. It cannot answer
// the questions an autonomous economic loop actually runs on: how much did we
// net TODAY, are we above or below the daily floor, what is the trailing
// 30-day trend, and how much of any of it is money we can prove.
//
// THE RULE THIS FILE ENFORCES. A projection is never profit. That guarantee is
// structural, not a convention:
//
//   * LedgerProvenance has no PROJECTED member, so a forecast cannot be stored
//     as a revenue or expense row in the first place.
//   * Expected returns live on the experiment contract (a different table) and
//     surface here as `outlook`, a field of a DIFFERENT TYPE from every
//     realized total, so the two cannot be added together by accident.
//   * SIMULATED rows are summed and reported, but never merged into the money
//     totals and never counted toward the floor or the objective. A dry run is
//     visible as a dry run.
//
// It reads the EXISTING EconomicRevenue/EconomicExpense rows. There is no
// second ledger, and this module writes nothing at all.
import { db } from "@/lib/db";
import type { LedgerProvenance } from "@/generated/prisma/enums";

/** The absolute minimum the economic engine is aiming at: $500 net profit/day. */
export const DAILY_NET_PROFIT_FLOOR_USD = 500;

/** The primary objective: $100,000 net profit in a 30-day window. */
export const MONTHLY_NET_PROFIT_OBJECTIVE_USD = 100_000;

export type PnlWindowName = "lifetime" | "today" | "trailing7d" | "trailing30d";

export interface LedgerTotals {
  revenueUsd: number;
  expenseUsd: number;
  netUsd: number;
  entryCount: number;
}

export interface PnlWindow {
  window: PnlWindowName;
  /** Null for lifetime — there is no start bound. */
  since: Date | null;
  until: Date;

  /**
   * Every provenance class, kept separate. Nothing downstream has to guess
   * which rows a number came from.
   */
  byProvenance: Record<LedgerProvenance, LedgerTotals>;

  /**
   * REALIZED only — money confirmed against an external system of record.
   * Today this is always zero, because VOX has no payment or banking
   * integration and therefore nothing can write a REALIZED row. That zero is
   * the honest answer, not a missing feature being papered over.
   */
  realized: LedgerTotals;

  /**
   * REALIZED + USER_RECORDED — what a human asserts happened. This is the
   * strongest claim VOX can currently make about money, and it is weaker than
   * `realized` on purpose: nothing has verified it.
   */
  recorded: LedgerTotals;

  /** SIMULATED only. Never money. Never counted toward a goal. */
  simulated: LedgerTotals;
}

export type GoalBasis = "REALIZED" | "RECORDED";

export interface GoalDistance {
  basis: GoalBasis;
  targetUsd: number;
  actualUsd: number;
  /** How far below target, never negative. Zero once the target is met. */
  shortfallUsd: number;
  /** How far above target, never negative. Zero until the target is met. */
  surplusUsd: number;
  /** actual / target. Can exceed 1; can be negative when the window lost money. */
  attainment: number;
  met: boolean;
}

export interface GoalStatus {
  label: string;
  periodDays: number;
  targetUsd: number;
  /** The measurement that counts. Currently always $0 — see PnlWindow.realized. */
  realized: GoalDistance;
  /** The same distance measured against human-entered rows, for context. */
  recorded: GoalDistance;
}

export type CapitalBasis = "REALIZED_LEDGER" | "NONE";

export interface CapitalPosture {
  /**
   * Spendable capital, in dollars — or null when VOX genuinely cannot know.
   *
   * It is null today and will stay null until a real account balance can be
   * read from somewhere. VOX deliberately does NOT synthesize a capital
   * account from a starting balance a user typed in, and does not treat
   * `maxAutonomousSpendUsd` as cash: that number is a POLICY CEILING, an
   * upper bound on what may be spent without asking, not a statement that the
   * money exists. Showing an invented balance is exactly the failure mode this
   * field is shaped to make impossible.
   */
  availableUsd: number | null;
  basis: CapitalBasis;
  /** Why `availableUsd` is what it is, in plain words, always populated. */
  reason: string;
  /** Policy, not money. Kept separate for exactly that reason. */
  policyCeilingUsd: number;
  /** Ceiling minus everything ever spent — an at-a-glance signal, not a balance. */
  policyRemainingUsd: number;
  /** True when the global economic halt is engaged. */
  halted: boolean;
  haltReason: string | null;
}

/**
 * Expectations, quarantined.
 *
 * Every number here is PROJECTED. It comes from experiment contracts, not from
 * the ledger, and it is a distinct type from LedgerTotals so that summing it
 * into profit is a type error rather than a bug someone has to notice.
 */
export interface ProjectedOutlook {
  readonly kind: "PROJECTED";
  /** Experiments whose execution status makes them live enough to project. */
  activeExperimentCount: number;
  expectedReturnUsd: number;
  expectedNetProfitUsd: number;
  /** Capital those contracts say they need. Not capital VOX has. */
  requiredCapitalUsd: number;
  /** Total downside those contracts have authorized. */
  maxAuthorizedLossUsd: number;
}

export interface PnlReport {
  generatedAt: Date;
  lifetime: PnlWindow;
  today: PnlWindow;
  trailing7d: PnlWindow;
  trailing30d: PnlWindow;
  capital: CapitalPosture;
  /** $500/day. Measured against `today`. */
  floor: GoalStatus;
  /** $100,000/month. Measured against `trailing30d`. */
  objective: GoalStatus;
  outlook: ProjectedOutlook;
}

interface LedgerRow {
  amountUsd: number;
  occurredAt: Date;
  provenance: LedgerProvenance;
}

const PROVENANCES: LedgerProvenance[] = ["REALIZED", "USER_RECORDED", "SIMULATED"];

function emptyTotals(): LedgerTotals {
  return { revenueUsd: 0, expenseUsd: 0, netUsd: 0, entryCount: 0 };
}

function add(totals: LedgerTotals, amountUsd: number, side: "revenue" | "expense"): void {
  if (side === "revenue") totals.revenueUsd += amountUsd;
  else totals.expenseUsd += amountUsd;
  totals.netUsd = totals.revenueUsd - totals.expenseUsd;
  totals.entryCount += 1;
}

/** Start of the local day containing `now`. Days are the floor's unit. */
export function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function rollup(
  revenues: LedgerRow[],
  expenses: LedgerRow[],
  window: PnlWindowName,
  since: Date | null,
  until: Date
): PnlWindow {
  const byProvenance = Object.fromEntries(PROVENANCES.map((p) => [p, emptyTotals()])) as Record<
    LedgerProvenance,
    LedgerTotals
  >;

  const inWindow = (row: LedgerRow) =>
    (since === null || row.occurredAt >= since) && row.occurredAt <= until;

  for (const row of revenues) if (inWindow(row)) add(byProvenance[row.provenance], row.amountUsd, "revenue");
  for (const row of expenses) if (inWindow(row)) add(byProvenance[row.provenance], row.amountUsd, "expense");

  const combine = (classes: LedgerProvenance[]): LedgerTotals => {
    const totals = emptyTotals();
    for (const c of classes) {
      totals.revenueUsd += byProvenance[c].revenueUsd;
      totals.expenseUsd += byProvenance[c].expenseUsd;
      totals.entryCount += byProvenance[c].entryCount;
    }
    totals.netUsd = totals.revenueUsd - totals.expenseUsd;
    return totals;
  };

  return {
    window,
    since,
    until,
    byProvenance,
    realized: combine(["REALIZED"]),
    // SIMULATED is deliberately absent here. A dry run is not money a human
    // recorded; folding it in would make the strongest available claim about
    // profit partly fictional.
    recorded: combine(["REALIZED", "USER_RECORDED"]),
    simulated: combine(["SIMULATED"]),
  };
}

function distance(basis: GoalBasis, targetUsd: number, actualUsd: number): GoalDistance {
  const delta = actualUsd - targetUsd;
  return {
    basis,
    targetUsd,
    actualUsd,
    shortfallUsd: delta < 0 ? -delta : 0,
    surplusUsd: delta > 0 ? delta : 0,
    attainment: targetUsd === 0 ? 0 : actualUsd / targetUsd,
    met: delta >= 0,
  };
}

function goal(label: string, periodDays: number, targetUsd: number, window: PnlWindow): GoalStatus {
  return {
    label,
    periodDays,
    targetUsd,
    realized: distance("REALIZED", targetUsd, window.realized.netUsd),
    recorded: distance("RECORDED", targetUsd, window.recorded.netUsd),
  };
}

/**
 * The whole picture, from real rows.
 *
 * One pass over the user's ledger; every window is computed from the same
 * fetched rows so the four windows can never disagree with each other about
 * what happened.
 */
export async function getPnlReport(userId: string, now: Date = new Date()): Promise<PnlReport> {
  const [revenues, expenses, user, spentAgg, experiments] = await Promise.all([
    db.economicRevenue.findMany({
      where: { asset: { userId } },
      select: { amountUsd: true, occurredAt: true, provenance: true },
    }),
    db.economicExpense.findMany({
      where: { asset: { userId } },
      select: { amountUsd: true, occurredAt: true, provenance: true },
    }),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { maxAutonomousSpendUsd: true, economicHaltedAt: true, economicHaltReason: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountUsd: true },
    }),
    db.experiment.findMany({
      where: { userId, executionStatus: { in: ["READY", "RUNNING", "AWAITING_HUMAN"] } },
      select: {
        expectedReturnUsd: true,
        expectedNetProfitUsd: true,
        requiredCapitalUsd: true,
        maxLossUsd: true,
      },
    }),
  ]);

  const lifetime = rollup(revenues, expenses, "lifetime", null, now);
  const today = rollup(revenues, expenses, "today", startOfDay(now), now);
  const trailing7d = rollup(revenues, expenses, "trailing7d", daysAgo(now, 7), now);
  const trailing30d = rollup(revenues, expenses, "trailing30d", daysAgo(now, 30), now);

  // Simulated spend is excluded from the policy tally on purpose: a dry run
  // never consumed the real ceiling, so counting it would silently throttle
  // real spending on the strength of pretend spending.
  const totalSpentUsd = spentAgg._sum.amountUsd ?? 0;

  const capital: CapitalPosture = {
    availableUsd: null,
    basis: "NONE",
    reason:
      "VOX has no connected account balance to read. No payment processor or bank " +
      "integration is configured, so there is no real cash position to report. The " +
      "autonomous spend ceiling below is a policy limit, not a balance.",
    policyCeilingUsd: user.maxAutonomousSpendUsd,
    policyRemainingUsd: Math.max(0, user.maxAutonomousSpendUsd - totalSpentUsd),
    halted: user.economicHaltedAt !== null,
    haltReason: user.economicHaltReason,
  };

  const outlook: ProjectedOutlook = {
    kind: "PROJECTED",
    activeExperimentCount: experiments.length,
    expectedReturnUsd: experiments.reduce((sum, e) => sum + (e.expectedReturnUsd ?? 0), 0),
    expectedNetProfitUsd: experiments.reduce((sum, e) => sum + (e.expectedNetProfitUsd ?? 0), 0),
    requiredCapitalUsd: experiments.reduce((sum, e) => sum + (e.requiredCapitalUsd ?? 0), 0),
    maxAuthorizedLossUsd: experiments.reduce((sum, e) => sum + (e.maxLossUsd ?? 0), 0),
  };

  return {
    generatedAt: now,
    lifetime,
    today,
    trailing7d,
    trailing30d,
    capital,
    floor: goal("Daily net profit floor", 1, DAILY_NET_PROFIT_FLOOR_USD, today),
    objective: goal("Monthly net profit objective", 30, MONTHLY_NET_PROFIT_OBJECTIVE_USD, trailing30d),
    outlook,
  };
}

/**
 * One experiment's own P&L, from the EconomicAsset it was linked to.
 *
 * This is what the decision layer measures a contract against. An experiment
 * with no asset has made and lost exactly nothing — which is a real answer, not
 * missing data, and is why it returns zeroed totals rather than null.
 */
export async function getExperimentLedger(
  userId: string,
  experimentId: string,
  now: Date = new Date()
): Promise<PnlWindow> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    select: { economicAssetId: true },
  });

  if (!experiment?.economicAssetId) return rollup([], [], "lifetime", null, now);

  const [revenues, expenses] = await Promise.all([
    db.economicRevenue.findMany({
      where: { assetId: experiment.economicAssetId },
      select: { amountUsd: true, occurredAt: true, provenance: true },
    }),
    db.economicExpense.findMany({
      where: { assetId: experiment.economicAssetId },
      select: { amountUsd: true, occurredAt: true, provenance: true },
    }),
  ]);

  return rollup(revenues, expenses, "lifetime", null, now);
}
