// The one definition of policy-consumed spend.
//
// WHY THIS EXISTS. Before this module there were two answers to "how much
// budget is left", and they disagreed:
//
//   * getBudgetSummary() summed EVERY EconomicExpense row, so a SIMULATED dry
//     run consumed the user's real autonomous-spend ceiling. Run a $400
//     simulation against a $500 ceiling and VOX would report $100 of real
//     budget remaining, having spent nothing.
//   * getPnlReport()'s capital posture filtered to REALIZED + USER_RECORDED,
//     so the Finance page showed both numbers at once, on the same screen,
//     each labelled as the truth.
//
// Two contradictory numbers is worse than one wrong number: it makes the wrong
// one unfalsifiable, because whichever you check, the other one is available to
// explain the discrepancy away. So there is now exactly one query, and every
// caller — the budget panel, the P&L capital posture, the spend policy, and the
// atomic guard on the spend itself — goes through it.
//
// WHICH PROVENANCES COUNT, and why:
//
//   REALIZED       COUNTS. Money confirmed against an external system of
//                  record. (Nothing can write it yet; see invariant I1.)
//   USER_RECORDED  COUNTS. A human asserts it was spent. VOX cannot verify it,
//                  but an unverified real spend still consumed real budget, and
//                  treating it as free would let the ceiling be evaded by
//                  simply not confirming anything.
//   SIMULATED      DOES NOT COUNT, ever. A dry run moved no money, so it cannot
//                  consume a limit on moving money. This is invariant I2.
import { db } from "@/lib/db";
import { fromCents } from "@/lib/economic/money";
import type { LedgerProvenance } from "@/generated/prisma/enums";

/**
 * The provenances that consume real economic policy budget.
 *
 * Exported as data, not inlined at call sites, so that a future provenance has
 * exactly one place to be classified and cannot be silently omitted from one
 * of the four callers.
 */
export const POLICY_CONSUMING_PROVENANCES: readonly LedgerProvenance[] = ["REALIZED", "USER_RECORDED"] as const;

/** The provenances excluded from every real-money total. */
export const NON_POLICY_PROVENANCES: readonly LedgerProvenance[] = ["SIMULATED"] as const;

export function consumesPolicyBudget(provenance: LedgerProvenance): boolean {
  return POLICY_CONSUMING_PROVENANCES.includes(provenance);
}

export interface PolicySpendPosition {
  /** The user's configured autonomous-spend ceiling, in cents. */
  ceilingCents: number;
  /** Policy-consuming expenses to date, in cents. Never includes SIMULATED. */
  spentCents: number;
  /** ceiling - spent, floored at 0. What a new spend is checked against. */
  remainingCents: number;
  /** Simulated spend, reported separately so a dry run stays visible. */
  simulatedCents: number;
  halted: boolean;
  haltReason: string | null;

  // USD mirrors, for display only. Derived from the cents above rather than
  // summed independently, so they cannot disagree with the canonical figures.
  ceilingUsd: number;
  spentUsd: number;
  remainingUsd: number;
  simulatedUsd: number;
}

/**
 * The canonical policy-spend position. One query, one definition.
 *
 * Sums `amountCents` — not `amountUsd` — because this number is compared
 * against a ceiling, and a float sum at a boundary is a coin flip.
 */
export async function getPolicySpendPosition(userId: string): Promise<PolicySpendPosition> {
  const [user, consuming, simulated] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { maxAutonomousSpendUsd: true, economicHaltedAt: true, economicHaltReason: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: [...POLICY_CONSUMING_PROVENANCES] } },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: { in: [...NON_POLICY_PROVENANCES] } },
      _sum: { amountCents: true },
    }),
  ]);

  const ceilingCents = ceilingToCents(user.maxAutonomousSpendUsd);
  const spentCents = consuming._sum.amountCents ?? 0;
  const simulatedCents = simulated._sum.amountCents ?? 0;
  const remainingCents = Math.max(0, ceilingCents - spentCents);

  return {
    ceilingCents,
    spentCents,
    remainingCents,
    simulatedCents,
    halted: user.economicHaltedAt !== null,
    haltReason: user.economicHaltReason,
    ceilingUsd: fromCents(ceilingCents),
    spentUsd: fromCents(spentCents),
    remainingUsd: fromCents(remainingCents),
    simulatedUsd: fromCents(simulatedCents),
  };
}

/**
 * The ceiling, in cents.
 *
 * `User.maxAutonomousSpendUsd` is still a Float (it is a setting, not a ledger
 * row, so it is not on the cents migration path). It is converted here rather
 * than at four call sites, and defensively: a corrupted non-finite ceiling
 * becomes 0 — deny everything — rather than propagating a NaN into a
 * comparison, where `spent + amount <= NaN` is false but `NaN` in a subtraction
 * would make "remaining" meaningless. Failing closed is the only safe direction
 * for a spend limit.
 */
export function ceilingToCents(maxAutonomousSpendUsd: number): number {
  if (!Number.isFinite(maxAutonomousSpendUsd) || maxAutonomousSpendUsd <= 0) return 0;
  return Math.floor(maxAutonomousSpendUsd * 100);
}
