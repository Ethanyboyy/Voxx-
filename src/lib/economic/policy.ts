// The economic decision/control layer: whether a proposed spend may proceed
// autonomously.
//
// WHAT THIS USED TO GET WRONG. It compared ONE amount against the ceiling:
// `if (amountUsd <= thresholdUsd)`. Cumulative spend was never consulted, so a
// $100 ceiling permitted $60, then another $60, then another, without limit —
// every request was individually "within the limit". The comment on
// getBudgetSummary even described this as deliberate ("each individual spend
// action is still evaluated independently against the ceiling, not against a
// running budget balance that could drift"), which is a coherent-sounding
// justification for an unbounded spend limit.
//
// It now asks the real question: would this spend, ADDED TO everything already
// spent, exceed the ceiling. It reads the one canonical position
// (accounting.ts), so it can never disagree with the budget panel or the P&L.
//
// THIS IS A PRE-FLIGHT CHECK, NOT THE ENFORCEMENT. It exists to give a caller a
// good error before doing work, and to keep the tool layer's message honest.
// The authoritative check is the atomic guard inside recordPolicySpend()
// (src/lib/economic/spend.ts), because any check that is a separate statement
// from the write has a window between them. Two concurrent requests can both
// pass THIS function; only one of them can pass the guard.
import { getPolicySpendPosition } from "@/lib/economic/accounting";
import { toCents, formatCents, InvalidMoneyError } from "@/lib/economic/money";

export interface SpendPolicyDecision {
  allowed: boolean;
  amountUsd: number;
  thresholdUsd: number;
  reason: string;
  /** True when the global economic halt is why this was denied. */
  halted?: boolean;
  /** Cumulative policy-consuming spend to date, in USD. Never includes SIMULATED. */
  alreadySpentUsd?: number;
  /** Ceiling minus cumulative spend, floored at 0. */
  remainingUsd?: number;
}

export async function evaluateSpendPolicy(userId: string, amountUsd: number): Promise<SpendPolicyDecision> {
  const position = await getPolicySpendPosition(userId);

  // A non-finite or non-positive amount is refused before any comparison. This
  // matters specifically because `NaN <= x` is false and `Infinity <= x` is
  // false, so both would be "denied" for the wrong reason and with a
  // nonsensical message — and a caller that only checks `allowed` would then
  // pass the same garbage to the write boundary.
  let cents: number;
  try {
    cents = toCents(amountUsd, "amountUsd");
  } catch (error) {
    return {
      allowed: false,
      amountUsd,
      thresholdUsd: position.ceilingUsd,
      reason: error instanceof InvalidMoneyError ? error.message : "The amount is not a valid monetary value.",
    };
  }

  // The halt outranks the ceiling, and is checked first so that a halted engine
  // refuses a one-cent spend as firmly as a ten-thousand-dollar one.
  if (position.halted) {
    return {
      allowed: false,
      amountUsd,
      thresholdUsd: position.ceilingUsd,
      halted: true,
      alreadySpentUsd: position.spentUsd,
      remainingUsd: position.remainingUsd,
      reason: `The global economic halt is engaged${position.haltReason ? `: ${position.haltReason}` : ""}. No autonomous spend may occur until it is released.`,
    };
  }

  const wouldTotalCents = position.spentCents + cents;

  if (wouldTotalCents <= position.ceilingCents) {
    return {
      allowed: true,
      amountUsd,
      thresholdUsd: position.ceilingUsd,
      alreadySpentUsd: position.spentUsd,
      remainingUsd: position.remainingUsd,
      reason: `${formatCents(cents)} would take autonomous spend to ${formatCents(wouldTotalCents)}, within the ceiling of ${formatCents(position.ceilingCents)}.`,
    };
  }

  return {
    allowed: false,
    amountUsd,
    thresholdUsd: position.ceilingUsd,
    alreadySpentUsd: position.spentUsd,
    remainingUsd: position.remainingUsd,
    reason: `${formatCents(cents)} would take autonomous spend to ${formatCents(wouldTotalCents)}, above the ceiling of ${formatCents(position.ceilingCents)} (${formatCents(position.remainingCents)} remaining). Human approval required.`,
  };
}
