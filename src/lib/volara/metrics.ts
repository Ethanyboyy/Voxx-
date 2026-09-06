/**
 * [P4-F] AUTHORITATIVE ECONOMIC METRICS — every figure derived, none stored.
 *
 * "Do not calculate financial truth from agent-reported prose. Metrics must
 * come from authoritative records." Every number below is computed from
 * `EconomicRevenue` / `EconomicExpense` rows, `CapitalAllocation` rows,
 * `Opportunity` statuses and `Strategy` statuses. Nothing reads an agent's
 * account of its own performance, because there is no column holding one.
 *
 * WHY THERE ARE NO CACHED TOTALS. A `revenueCents` column on `Agent` would be
 * faster and would be wrong the first time a ledger row was written by any path
 * that forgot to update it. The rows are the truth; the totals are a view of
 * them. If these queries ever become a real cost the fix is a materialized
 * snapshot with an explicit refresh, not a counter that drifts silently.
 *
 * SIMULATED LEDGER ROWS ARE EXCLUDED EVERYWHERE, using the same provenance
 * filter as the spend ceiling. A dry run is recorded — better than being
 * indistinguishable from no run — but it is not money, and letting it into an
 * ROI would be presenting a mock economic result as a real one.
 */

import { db } from "@/lib/db";
import { fromCents } from "@/lib/economic/money";
import { getTreasuryPosition, type TreasuryPosition } from "@/lib/volara/treasury";

/** The provenances that represent real money. Matches the ledger's own filter. */
const REAL_PROVENANCE = ["REALIZED", "USER_RECORDED"] as const;

export interface SystemMetrics {
  treasury: TreasuryPosition;
  revenueCents: number;
  expensesCents: number;
  netProfitCents: number;
  /** Profit ÷ capital deployed. Null when nothing has been deployed — not zero. */
  roi: number | null;
  capitalDeployedCents: number;
  /** Deployed ÷ ceiling. Null when there is no ceiling to utilize. */
  capitalUtilization: number | null;
  /** Expenses over the trailing window. Real burn, not a projection. */
  burnCents: number;
  activeStrategies: number;
  successfulStrategies: number;
  failedStrategies: number;
  totalOpportunities: number;
  wonOpportunities: number;
  lostOpportunities: number;
  /** Won ÷ settled. Null while nothing has settled. */
  winRate: number | null;
  /** Mean days from discovery to settlement, over settled rows. Null when none. */
  averageTimeToPayoutDays: number | null;
}

/** Trailing window for burn. Thirty days, stated rather than implied. */
export const BURN_WINDOW_DAYS = 30;

export async function getSystemMetrics(userId: string, now: Date = new Date()): Promise<SystemMetrics> {
  const burnSince = new Date(now.getTime() - BURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [treasury, revenue, expenses, burn, strategies, opportunities, settled] = await Promise.all([
    getTreasuryPosition(userId),
    db.economicRevenue.aggregate({
      where: { asset: { userId }, provenance: { in: [...REAL_PROVENANCE] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: [...REAL_PROVENANCE] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: [...REAL_PROVENANCE] }, occurredAt: { gte: burnSince } },
      _sum: { amountCents: true },
    }),
    db.strategy.groupBy({ by: ["status"], where: { userId }, _count: true }),
    db.opportunity.groupBy({ by: ["status"], where: { userId }, _count: true }),
    db.opportunity.findMany({
      where: { userId, status: { in: ["COMPLETED", "FAILED"] } },
      select: { discoveredAt: true, updatedAt: true },
    }),
  ]);

  const revenueCents = revenue._sum.amountCents ?? 0;
  const expensesCents = expenses._sum.amountCents ?? 0;
  const netProfitCents = revenueCents - expensesCents;
  const capitalDeployedCents = treasury.deployedCents;

  const countBy = (rows: Array<{ status: string; _count: number }>, statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count, 0);

  const wonOpportunities = countBy(opportunities, ["COMPLETED"]);
  const lostOpportunities = countBy(opportunities, ["FAILED"]);
  const settledCount = wonOpportunities + lostOpportunities;

  const payoutDays = settled.map(
    (row) => (row.updatedAt.getTime() - row.discoveredAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    treasury,
    revenueCents,
    expensesCents,
    netProfitCents,
    // Null, not zero. "No return yet" and "a return of zero" are different
    // facts, and collapsing them makes an untested system look break-even.
    roi: capitalDeployedCents > 0 ? netProfitCents / capitalDeployedCents : null,
    capitalDeployedCents,
    capitalUtilization: treasury.ceilingCents > 0 ? capitalDeployedCents / treasury.ceilingCents : null,
    burnCents: burn._sum.amountCents ?? 0,
    activeStrategies: countBy(strategies, ["ACTIVE", "TESTING", "MEASURING"]),
    successfulStrategies: countBy(strategies, ["COMPLETED"]),
    failedStrategies: countBy(strategies, ["KILLED"]),
    totalOpportunities: opportunities.reduce((sum, row) => sum + row._count, 0),
    wonOpportunities,
    lostOpportunities,
    winRate: settledCount > 0 ? wonOpportunities / settledCount : null,
    averageTimeToPayoutDays:
      payoutDays.length > 0 ? payoutDays.reduce((sum, days) => sum + days, 0) / payoutDays.length : null,
  };
}

export interface AgentMetrics {
  agentId: string;
  name: string;
  role: string | null;
  capitalRequestedCents: number;
  capitalAllocatedCents: number;
  capitalDeployedCents: number;
  revenueCents: number;
  expensesCents: number;
  profitCents: number;
  roi: number | null;
  opportunitiesDiscovered: number;
  strategiesProposed: number;
  strategiesActive: number;
  strategiesWon: number;
  strategiesKilled: number;
  winRate: number | null;
  failureCount: number;
  consecutiveFailures: number;
  failureRate: number | null;
  cycleCount: number;
  /** Mean seconds between an agent's recorded transitions. Null with too few. */
  averageCycleSeconds: number | null;
}

/**
 * Per-agent performance, attributed through the allocations the agent
 * requested and the opportunities those allocations name.
 *
 * That attribution chain is the honest one available: money is spent against an
 * `EconomicAsset`, which belongs to an `Opportunity`, which an allocation
 * names, which an agent requested. An agent that requested no capital has
 * earned and spent nothing through this runtime, and its figures are zero
 * rather than a share of the system's.
 */
export async function getAgentMetrics(userId: string, agentId: string): Promise<AgentMetrics | null> {
  const agent = await db.agent.findFirst({
    where: { id: agentId, userId },
    select: {
      id: true,
      name: true,
      role: true,
      failureCount: true,
      consecutiveFailures: true,
      cycleCount: true,
    },
  });
  if (!agent) return null;

  const [allocations, discovered, strategies, transitions] = await Promise.all([
    db.capitalAllocation.findMany({
      where: { userId, agentId },
      select: { requestedCents: true, approvedCents: true, consumedCents: true, status: true, opportunityId: true },
    }),
    db.opportunity.count({ where: { userId, discoveredByAgentId: agentId } }),
    db.strategy.groupBy({ by: ["status"], where: { userId, ownerAgentId: agentId }, _count: true }),
    db.agentStateTransition.findMany({
      where: { userId, agentId, refused: false },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  const opportunityIds = allocations
    .map((allocation) => allocation.opportunityId)
    .filter((id): id is string => id !== null);

  const assets =
    opportunityIds.length > 0
      ? await db.economicAsset.findMany({
          where: { userId, opportunityId: { in: opportunityIds } },
          select: { id: true },
        })
      : [];
  const assetIds = assets.map((asset) => asset.id);

  const [revenue, expenses] = await Promise.all([
    assetIds.length > 0
      ? db.economicRevenue.aggregate({
          where: { assetId: { in: assetIds }, provenance: { in: [...REAL_PROVENANCE] } },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 } }),
    assetIds.length > 0
      ? db.economicExpense.aggregate({
          where: { assetId: { in: assetIds }, provenance: { in: [...REAL_PROVENANCE] } },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 } }),
  ]);

  const revenueCents = revenue._sum.amountCents ?? 0;
  const expensesCents = expenses._sum.amountCents ?? 0;
  const profitCents = revenueCents - expensesCents;
  const capitalDeployedCents = allocations.reduce((sum, a) => sum + a.consumedCents, 0);

  const countBy = (rows: Array<{ status: string; _count: number }>, statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count, 0);
  const strategiesWon = countBy(strategies, ["COMPLETED"]);
  const strategiesKilled = countBy(strategies, ["KILLED"]);
  const strategiesSettled = strategiesWon + strategiesKilled;

  // Mean gap between consecutive recorded transitions. Two transitions give one
  // gap; fewer give none, and reporting a cycle time from a single point would
  // be inventing a rate.
  let averageCycleSeconds: number | null = null;
  if (transitions.length >= 2) {
    let total = 0;
    for (let i = 1; i < transitions.length; i++) {
      total += transitions[i].createdAt.getTime() - transitions[i - 1].createdAt.getTime();
    }
    averageCycleSeconds = total / (transitions.length - 1) / 1000;
  }

  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    capitalRequestedCents: allocations.reduce((sum, a) => sum + a.requestedCents, 0),
    capitalAllocatedCents: allocations
      .filter((a) => a.status === "APPROVED" || a.status === "CONSUMED")
      .reduce((sum, a) => sum + a.approvedCents, 0),
    capitalDeployedCents,
    revenueCents,
    expensesCents,
    profitCents,
    roi: capitalDeployedCents > 0 ? profitCents / capitalDeployedCents : null,
    opportunitiesDiscovered: discovered,
    strategiesProposed: strategies.reduce((sum, row) => sum + row._count, 0),
    strategiesActive: countBy(strategies, ["ACTIVE", "TESTING", "MEASURING"]),
    strategiesWon,
    strategiesKilled,
    winRate: strategiesSettled > 0 ? strategiesWon / strategiesSettled : null,
    failureCount: agent.failureCount,
    consecutiveFailures: agent.consecutiveFailures,
    failureRate: agent.cycleCount > 0 ? agent.failureCount / agent.cycleCount : null,
    cycleCount: agent.cycleCount,
    averageCycleSeconds,
  };
}

export interface StrategyMetrics {
  strategyId: string;
  name: string;
  status: string;
  capitalAllocatedCents: number;
  capitalDeployedCents: number;
  revenueCents: number;
  profitCents: number;
  roi: number | null;
  durationDays: number | null;
  /** The estimate that was recorded, kept beside the actual for comparison. */
  probabilityEstimate: number | null;
  /** Derived: profit above zero on real ledger rows. Null when nothing settled. */
  actualSuccess: boolean | null;
  failureReason: string | null;
  replicationCount: number;
}

export async function getStrategyMetrics(userId: string, strategyId: string): Promise<StrategyMetrics | null> {
  const strategy = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    include: {
      allocations: { select: { approvedCents: true, consumedCents: true, status: true, opportunityId: true } },
      _count: { select: { replicas: true } },
    },
  });
  if (!strategy) return null;

  const opportunityIds = strategy.allocations
    .map((allocation) => allocation.opportunityId)
    .filter((id): id is string => id !== null);

  const assets =
    opportunityIds.length > 0
      ? await db.economicAsset.findMany({
          where: { userId, opportunityId: { in: opportunityIds } },
          select: { id: true },
        })
      : [];
  const assetIds = assets.map((asset) => asset.id);

  const [revenue, expenses] = await Promise.all([
    assetIds.length > 0
      ? db.economicRevenue.aggregate({
          where: { assetId: { in: assetIds }, provenance: { in: [...REAL_PROVENANCE] } },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 } }),
    assetIds.length > 0
      ? db.economicExpense.aggregate({
          where: { assetId: { in: assetIds }, provenance: { in: [...REAL_PROVENANCE] } },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 } }),
  ]);

  const revenueCents = revenue._sum.amountCents ?? 0;
  const expensesCents = expenses._sum.amountCents ?? 0;
  const profitCents = revenueCents - expensesCents;
  const capitalDeployedCents = strategy.allocations.reduce((sum, a) => sum + a.consumedCents, 0);
  const hasLedgerActivity = assetIds.length > 0 && (revenueCents > 0 || expensesCents > 0);

  const end = strategy.killedAt ?? strategy.updatedAt;
  const durationDays = strategy.activatedByHumanAt
    ? (end.getTime() - strategy.activatedByHumanAt.getTime()) / (24 * 60 * 60 * 1000)
    : null;

  return {
    strategyId: strategy.id,
    name: strategy.name,
    status: strategy.status,
    capitalAllocatedCents: strategy.allocations
      .filter((a) => a.status === "APPROVED" || a.status === "CONSUMED")
      .reduce((sum, a) => sum + a.approvedCents, 0),
    capitalDeployedCents,
    revenueCents,
    profitCents,
    roi: capitalDeployedCents > 0 ? profitCents / capitalDeployedCents : null,
    durationDays,
    probabilityEstimate: strategy.probabilityOfSuccess,
    // Null while there is no ledger activity at all. A strategy that has not
    // spent or earned has not succeeded OR failed, and saying `false` would
    // record a loss that did not happen.
    actualSuccess: hasLedgerActivity ? profitCents > 0 : null,
    failureReason: strategy.outcomeReason,
    replicationCount: strategy._count.replicas,
  };
}

/** USD mirrors for a system snapshot. Display only; cents remain the arithmetic. */
export function toDisplayUsd(metrics: SystemMetrics) {
  return {
    revenueUsd: fromCents(metrics.revenueCents),
    expensesUsd: fromCents(metrics.expensesCents),
    netProfitUsd: fromCents(metrics.netProfitCents),
    burnUsd: fromCents(metrics.burnCents),
    capitalDeployedUsd: fromCents(metrics.capitalDeployedCents),
  };
}
