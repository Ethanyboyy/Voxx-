/**
 * [P6-A] WHICH OPPORTUNITIES SHOULD BE ACTIVE, AND FOR HOW MUCH.
 *
 * Pure selection: the inputs are an already-computed set of expectations plus
 * the real capital position, and the output is a PROPOSAL. Nothing here
 * allocates money, reserves money, or authorizes anything. Committing capital
 * remains `volara/governor.ts#requestCapital()` → a human's `ApprovalGrant` →
 * `approveCapitalAllocation()`, exactly as P4-F built it.
 *
 * That separation is deliberate and load-bearing. A selector that could also
 * allocate would be a second capital path, and the first thing a second capital
 * path loses is the governor's reserve, concentration and failure-history
 * refusals. So this module reuses the governor's OWN constants rather than
 * declaring its own — if `CONCENTRATION_FRACTION` changes, both agree, because
 * there is only one of it.
 *
 * ---------------------------------------------------------------------------
 * WHY N IS NOT A CONSTANT
 * ---------------------------------------------------------------------------
 *
 * There is no hardcoded number of streams. How many opportunities can be active
 * is DERIVED, every time, from four independent limits, and whichever binds
 * first is the one that binds:
 *
 *   CAPITAL        the deployable position, less the governor's reserve
 *   CONCENTRATION  no single opportunity may take more than its share
 *   CONCURRENCY    how many experiments can genuinely be run at once
 *   EVIDENCE       a negative expectation is never selected at any size
 *
 * So three worth scaling and twelve worth killing is the natural output, and so
 * is zero — which is the correct answer when the capital position is spent or
 * nothing has been researched, and is reported as such rather than as a
 * portfolio of hopeful nothings.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS MOST
 * ---------------------------------------------------------------------------
 *
 * A MODEL'S NUMBERS CANNOT RESERVE MONEY. An opportunity whose monetary basis
 * is `MODEL_SUGGESTED` or weaker is never proposed for capital — it is routed
 * to `CORROBORATE` instead. The point is not that models are useless here; it
 * is that a model proposing "$4,000/month, 60% likely" and a person recording
 * the same figures must not produce the same spend.
 */

import { CONCENTRATION_FRACTION, RESERVE_FRACTION } from "@/lib/volara/governor";
import { formatCents } from "@/lib/economic/money";
import { CAPITAL_MINIMUM_BASIS, describeBasis, type EstimateBasis } from "@/lib/economic/estimate";
import type { Expectation, RankableExpectation, UnrankableExpectation } from "@/lib/economic/expectedValue";
import { rankByExpectedValue } from "@/lib/economic/expectedValue";

/**
 * How many experiments may be active at once.
 *
 * Four. Not a capital limit — an ATTENTION limit. Every active experiment needs
 * its window observed, its measurement reconciled and its decision taken, and a
 * portfolio whose results nobody reconciles produces no evidence at all, which
 * is strictly worse than a smaller portfolio that does. The number rises when
 * the observation loop is shown to keep up, not because more looked ambitious.
 */
export const MAX_CONCURRENT_EXPERIMENTS = 4;

/** The smallest capital slice worth proposing. Below this the overhead dominates. */
export const MIN_ALLOCATION_CENTS = 500;

export type DeferralReason =
  /** Expected net is zero or negative. The arithmetic says no. */
  | "NEGATIVE_EXPECTATION"
  /** Its basis is too weak to justify money, however good the number looks. */
  | "BASIS_TOO_WEAK"
  /** Deployable capital is exhausted by higher-ranked opportunities. */
  | "CAPITAL_EXHAUSTED"
  /** The concurrency limit is reached. Attention, not money. */
  | "CONCURRENCY_REACHED"
  /** Its own capital requirement exceeds the per-opportunity concentration cap. */
  | "EXCEEDS_CONCENTRATION_CAP"
  /** Its slice would be below the minimum worth proposing. */
  | "BELOW_MINIMUM_ALLOCATION"
  /** The engine is halted. Nothing new begins. */
  | "HALTED";

export interface PortfolioSelection {
  expectation: RankableExpectation;
  /**
   * Capital this opportunity is PROPOSED to receive, in cents.
   *
   * A proposal. It becomes a reservation only through `requestCapital()` and a
   * human's approval, and the governor may still refuse it or approve less.
   */
  proposedCapitalCents: number;
  rationale: string;
}

export interface PortfolioDeferral {
  opportunityId: string;
  reason: DeferralReason;
  detail: string;
  /** Present when the opportunity was rankable and still not selected. */
  expectedNetPerDayCents: number | null;
}

export interface PortfolioPlan {
  /** What to pursue, in order, with proposed capital. */
  selected: PortfolioSelection[];
  /** What was rankable and not selected, each with the binding reason. */
  deferred: PortfolioDeferral[];
  /** What could not be ranked at all, with the dimensions to go and establish. */
  unrankable: UnrankableExpectation[];
  /** The limits as they stood, so the plan stays inspectable after they move. */
  limits: {
    deployableCents: number;
    reservedCents: number;
    allocatableCents: number;
    concentrationCapCents: number;
    concurrencySlots: number;
    halted: boolean;
  };
  /** Total capital the plan proposes. Never exceeds `allocatableCents`. */
  proposedTotalCents: number;
  /** Sum of selected expectations, per day. An ESTIMATE, labelled as one. */
  expectedNetPerDayCents: number;
}

export interface PortfolioInput {
  expectations: readonly Expectation[];
  /** Capital genuinely available, in cents — from the real position, not a guess. */
  deployableCents: number;
  /** How many experiments are already running. Counts against concurrency. */
  activeExperiments: number;
  halted: boolean;
}

/**
 * Builds the plan.
 *
 * Greedy by expected net per day, under the capital and concurrency limits.
 * GREEDY IS A HEURISTIC, not an optimum — this is a bounded knapsack and the
 * greedy answer can be beaten. It is used anyway because the inputs are
 * estimates with wide error bars, and an exact optimiser over uncertain numbers
 * buys precision that the inputs cannot support while making the result much
 * harder to explain. An ordering a person can follow is worth more here than a
 * marginally better one they cannot.
 */
export function selectPortfolio(input: PortfolioInput): PortfolioPlan {
  const { ranked, unrankable } = rankByExpectedValue(input.expectations);

  const deployableCents = Math.max(0, Math.round(input.deployableCents));
  // The governor's own reserve, so VOX never plans to deploy its last cent.
  const reservedCents = Math.round(deployableCents * RESERVE_FRACTION);
  const allocatableCents = Math.max(0, deployableCents - reservedCents);
  const concentrationCapCents = Math.round(allocatableCents * CONCENTRATION_FRACTION);
  const concurrencySlots = Math.max(0, MAX_CONCURRENT_EXPERIMENTS - Math.max(0, input.activeExperiments));

  const selected: PortfolioSelection[] = [];
  const deferred: PortfolioDeferral[] = [];
  let remainingCents = allocatableCents;
  let slots = concurrencySlots;

  for (const expectation of ranked) {
    const defer = (reason: DeferralReason, detail: string) =>
      deferred.push({
        opportunityId: expectation.opportunityId,
        reason,
        detail,
        expectedNetPerDayCents: expectation.expectedNetPerDayCents,
      });

    // ---- THE HALT, FIRST -------------------------------------------------
    // Consistent with `decide()`: a halt stops anything NEW beginning. It does
    // not stop an existing experiment being killed, which is not this module's
    // business anyway.
    if (input.halted) {
      defer("HALTED", "The economic engine is halted, so nothing new is proposed.");
      continue;
    }

    // ---- THE ARITHMETIC SAYS NO -----------------------------------------
    // Checked before every limit, because an opportunity with a negative
    // expectation should not be selected even if capital and attention are
    // abundant. "We had room" is not a reason to take a losing bet.
    if (expectation.expectedNetCents <= 0) {
      defer(
        "NEGATIVE_EXPECTATION",
        `Expected net is ${formatCents(expectation.expectedNetCents)} — the downside outweighs the upside at the stated probability.`
      );
      continue;
    }

    // ---- A MODEL'S NUMBERS CANNOT RESERVE MONEY -------------------------
    if (!expectation.capitalEligible) {
      defer(
        "BASIS_TOO_WEAK",
        `Its weakest monetary input is ${describeBasis(expectation.basis)}, which is below the minimum for committing capital (${describeBasis(CAPITAL_MINIMUM_BASIS)}). Corroborate it before funding it.`
      );
      continue;
    }

    if (slots <= 0) {
      defer(
        "CONCURRENCY_REACHED",
        `${MAX_CONCURRENT_EXPERIMENTS} experiments is the limit on what can actually be observed and reconciled at once.`
      );
      continue;
    }

    const required = expectation.terms.requiredCapitalCents;
    // An opportunity with no capital requirement established is still
    // selectable — plenty of genuine opportunities need time rather than money —
    // but it is proposed ZERO capital rather than an assumed amount.
    const want = required ?? 0;

    if (want > concentrationCapCents) {
      defer(
        "EXCEEDS_CONCENTRATION_CAP",
        `It needs ${formatCents(want)}, above the ${formatCents(concentrationCapCents)} any single opportunity may hold (${Math.round(CONCENTRATION_FRACTION * 100)}% of allocatable capital).`
      );
      continue;
    }
    if (want > remainingCents) {
      defer(
        "CAPITAL_EXHAUSTED",
        `It needs ${formatCents(want)} and ${formatCents(remainingCents)} is left after the higher-ranked opportunities.`
      );
      continue;
    }
    if (want > 0 && want < MIN_ALLOCATION_CENTS) {
      defer(
        "BELOW_MINIMUM_ALLOCATION",
        `It needs ${formatCents(want)}, below the ${formatCents(MIN_ALLOCATION_CENTS)} minimum worth proposing separately.`
      );
      continue;
    }

    selected.push({
      expectation,
      proposedCapitalCents: want,
      rationale:
        `Ranked on expected net per day (${formatCents(expectation.expectedNetPerDayCents)}/day), ` +
        `basis ${describeBasis(expectation.basis)}. ` +
        (want === 0
          ? "Needs no capital, so none is proposed."
          : `Proposes ${formatCents(want)}, within the ${formatCents(concentrationCapCents)} per-opportunity cap.`),
    });
    remainingCents -= want;
    slots -= 1;
  }

  const proposedTotalCents = selected.reduce((sum, s) => sum + s.proposedCapitalCents, 0);

  return {
    selected,
    deferred,
    unrankable,
    limits: {
      deployableCents,
      reservedCents,
      allocatableCents,
      concentrationCapCents,
      concurrencySlots,
      halted: input.halted,
    },
    proposedTotalCents,
    expectedNetPerDayCents: selected.reduce((sum, s) => sum + s.expectation.expectedNetPerDayCents, 0),
  };
}

/**
 * Concentration across what is actually selected.
 *
 * Reported rather than enforced a second time — the per-opportunity cap above
 * is the enforcement. This exists so a surface can say "one opportunity holds
 * 80% of deployed capital", which is a true and useful thing to see even when
 * every individual allocation was within its cap.
 */
export function concentrationOf(plan: PortfolioPlan): { maxShare: number; opportunityId: string | null } {
  if (plan.proposedTotalCents === 0) return { maxShare: 0, opportunityId: null };
  let maxShare = 0;
  let opportunityId: string | null = null;
  for (const s of plan.selected) {
    const share = s.proposedCapitalCents / plan.proposedTotalCents;
    if (share > maxShare) {
      maxShare = share;
      opportunityId = s.expectation.opportunityId;
    }
  }
  return { maxShare, opportunityId };
}

/** Re-exported so a caller sees the basis floor without importing two modules. */
export { CAPITAL_MINIMUM_BASIS };
export type { EstimateBasis };
