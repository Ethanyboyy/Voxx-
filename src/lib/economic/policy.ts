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
}

export async function evaluateSpendPolicy(userId: string, amountUsd: number): Promise<SpendPolicyDecision> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { maxAutonomousSpendUsd: true } });
  const thresholdUsd = user.maxAutonomousSpendUsd;

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
