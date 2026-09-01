// The economic decision/control layer: determines whether a proposed spend
// may proceed autonomously, purely by comparing it to the user's own
// configured ceiling (User.maxAutonomousSpendUsd). This is a DECISION layer
// only — it is not wired to any real payment method. It never widens what
// the underlying capability system already allows; the economic.spend
// capability check (Tool Registry) still runs first and independently.
import { db } from "@/lib/db";

export interface SpendPolicyDecision {
  allowed: boolean;
  amountUsd: number;
  thresholdUsd: number;
  reason: string;
  /** True when the global economic halt is why this was denied. */
  halted?: boolean;
}

export async function evaluateSpendPolicy(userId: string, amountUsd: number): Promise<SpendPolicyDecision> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { maxAutonomousSpendUsd: true, economicHaltedAt: true, economicHaltReason: true },
  });
  const thresholdUsd = user.maxAutonomousSpendUsd;

  // The global economic halt outranks the ceiling. Checked first so that a
  // halted engine denies a $0.01 spend as firmly as a $10,000 one — a halt
  // that only stops large spends is not a halt. See src/lib/economic/halt.ts.
  if (user.economicHaltedAt !== null) {
    return {
      allowed: false,
      amountUsd,
      thresholdUsd,
      halted: true,
      reason: `The global economic halt is engaged${user.economicHaltReason ? `: ${user.economicHaltReason}` : ""}. No autonomous spend may occur until it is released.`,
    };
  }

  if (amountUsd <= thresholdUsd) {
    return {
      allowed: true,
      amountUsd,
      thresholdUsd,
      reason: `$${amountUsd.toFixed(2)} is within the autonomous spending limit of $${thresholdUsd.toFixed(2)}.`,
    };
  }

  return {
    allowed: false,
    amountUsd,
    thresholdUsd,
    reason: `$${amountUsd.toFixed(2)} exceeds the autonomous spending limit of $${thresholdUsd.toFixed(2)}. Human approval required.`,
  };
}
