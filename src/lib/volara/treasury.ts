/**
 * [P4-F] THE ECONOMIC CONTROL PLANE — one derived position, no stored balance.
 *
 * The brief's requirement is "authoritative awareness" of treasury, available,
 * reserved, deployed, pending, realized revenue/expenses/profit and exposure,
 * and — in the same breath — "do not maintain competing balances in multiple
 * places". Those two are only compatible one way: compute the position from the
 * rows that already are the truth, every time it is asked for.
 *
 *   ceiling   = User.maxAutonomousSpendUsd × 100         (only a human raises it)
 *   spent     = Σ EconomicExpense.amountCents (REALIZED | USER_RECORDED)
 *   reserved  = Σ CapitalAllocation.approvedCents WHERE status = APPROVED
 *   available = max(0, ceiling − spent − reserved)
 *
 * `spent` comes from `getPolicySpendPosition()` — the SAME function
 * `recordPolicySpend()`'s refusal path reports from, and the same provenance
 * filter its atomic SQL guard uses. Recomputing that sum here with a subtly
 * different `WHERE` is precisely how two "authoritative" numbers start
 * disagreeing, so it is imported rather than reimplemented.
 *
 * THERE IS NO WRITE PATH IN THIS FILE. No credit, no top-up, no setBalance. The
 * only two ways the position can move are a human changing the ceiling and the
 * existing ledger gaining a row — neither of which is reachable from here.
 *
 * A RESERVATION IS NOT A SPEND. An APPROVED allocation reduces `available` but
 * has not touched the ledger, so `spent` is unchanged. When the money is
 * actually spent it goes through `recordPolicySpend()`, which re-checks the
 * halt and the cumulative ceiling in its own atomic statement — the reservation
 * is a second, tighter constraint layered over that one, never a replacement.
 */

import { db } from "@/lib/db";
import { getPolicySpendPosition } from "@/lib/economic/accounting";
import { fromCents } from "@/lib/economic/money";

export interface TreasuryPosition {
  ceilingCents: number;
  /** Actually spent through the ledger. Real money gone. */
  spentCents: number;
  /** Approved and set aside, not yet spent. */
  reservedCents: number;
  /** Of the reserved, how much has since been drawn down. */
  deployedCents: number;
  /** Requested but not yet decided. Constrains nothing — it is only visibility. */
  pendingCents: number;
  /** ceiling − spent − reserved, floored at zero. */
  availableCents: number;
  /** Realized, from the ledger. Never an estimate. */
  realizedRevenueCents: number;
  realizedExpenseCents: number;
  realizedProfitCents: number;
  /** Reserved but not yet spent — what is at risk without having left yet. */
  unrealizedExposureCents: number;
  halted: boolean;
  haltReason: string | null;
  /** USD mirrors, for display only. Cents are the arithmetic. */
  ceilingUsd: number;
  spentUsd: number;
  reservedUsd: number;
  availableUsd: number;
  realizedProfitUsd: number;
}

/**
 * The authoritative position, computed fresh.
 *
 * Every query is scoped to `userId`, including through the asset join on the
 * ledger sums — an aggregate that forgot that scope would blend one account's
 * money into another's ceiling.
 */
export async function getTreasuryPosition(userId: string): Promise<TreasuryPosition> {
  const [spendPosition, reserved, deployed, pending, revenue, expenses] = await Promise.all([
    getPolicySpendPosition(userId),
    db.capitalAllocation.aggregate({
      where: { userId, status: "APPROVED" },
      _sum: { approvedCents: true },
    }),
    db.capitalAllocation.aggregate({
      where: { userId, status: { in: ["APPROVED", "CONSUMED"] } },
      _sum: { consumedCents: true },
    }),
    db.capitalAllocation.aggregate({
      where: { userId, status: "REQUESTED" },
      _sum: { requestedCents: true },
    }),
    db.economicRevenue.aggregate({
      where: { asset: { userId }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
    }),
  ]);

  const ceilingCents = spendPosition.ceilingCents;
  const spentCents = spendPosition.spentCents;
  const reservedCents = reserved._sum.approvedCents ?? 0;
  const deployedCents = deployed._sum.consumedCents ?? 0;
  const pendingCents = pending._sum.requestedCents ?? 0;
  const availableCents = Math.max(0, ceilingCents - spentCents - reservedCents);
  const realizedRevenueCents = revenue._sum.amountCents ?? 0;
  const realizedExpenseCents = expenses._sum.amountCents ?? 0;

  return {
    ceilingCents,
    spentCents,
    reservedCents,
    deployedCents,
    pendingCents,
    availableCents,
    realizedRevenueCents,
    realizedExpenseCents,
    realizedProfitCents: realizedRevenueCents - realizedExpenseCents,
    // What is committed but not yet gone. Deliberately not "reserved minus
    // deployed plus pending": a pending request commits nothing, because a
    // human may simply say no.
    unrealizedExposureCents: Math.max(0, reservedCents - deployedCents),
    halted: spendPosition.halted,
    haltReason: spendPosition.haltReason,
    ceilingUsd: fromCents(ceilingCents),
    spentUsd: fromCents(spentCents),
    reservedUsd: fromCents(reservedCents),
    availableUsd: fromCents(availableCents),
    realizedProfitUsd: fromCents(realizedRevenueCents - realizedExpenseCents),
  };
}

/**
 * Live capital committed under one strategy — the number the governor checks
 * `Strategy.maxCapitalCents` against.
 *
 * REQUESTED is deliberately excluded. A pending request has committed nothing,
 * and counting it would let an agent exhaust its own strategy's cap by asking
 * repeatedly, which is a denial of service against the humans who have to
 * answer.
 */
export async function getStrategyCommittedCents(userId: string, strategyId: string): Promise<number> {
  const committed = await db.capitalAllocation.aggregate({
    where: { userId, strategyId, status: { in: ["APPROVED", "CONSUMED"] } },
    _sum: { approvedCents: true },
  });
  return committed._sum.approvedCents ?? 0;
}

/** Live capital committed to one agent. Used for concentration checks. */
export async function getAgentCommittedCents(userId: string, agentId: string): Promise<number> {
  const committed = await db.capitalAllocation.aggregate({
    where: { userId, agentId, status: { in: ["APPROVED", "CONSUMED"] } },
    _sum: { approvedCents: true },
  });
  return committed._sum.approvedCents ?? 0;
}
