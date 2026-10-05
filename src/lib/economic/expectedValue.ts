/**
 * [P6-A] EXPECTED NET PROFIT, OR AN EXPLICIT REFUSAL TO RANK.
 *
 * A pure module: arithmetic over an `OpportunityModelView`, no database, no
 * clock, no model call. It replaces nothing — `scoreOpportunity()` stays as the
 * human-facing pipeline heuristic — and it answers a different question.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND RANKING FUNCTION, AND WHY IT IS IN CENTS
 * ---------------------------------------------------------------------------
 *
 * `scoreOpportunity()` returns a dimensionless number: value divided by effort,
 * multiplied by weights. That is usable for sorting a list a person is reading
 * and useless for every decision that actually matters, because it cannot be
 * compared to anything real. You cannot ask whether a score of 42 justifies
 * $500 of a remaining $2,000. You cannot subtract one score from another and
 * get an opportunity cost. You cannot add scores across a portfolio.
 *
 * Expected net profit in CENTS can do all three. So the output here is money,
 * and the honesty requirement that comes with that is absolute: it is an
 * ESTIMATE, it carries its basis, and it must never reach the ledger.
 * `LedgerProvenance` has no `PROJECTED` member specifically so a forecast
 * cannot be summed into profit, and nothing in this module may become the
 * exception to that.
 *
 * ---------------------------------------------------------------------------
 * THE ARITHMETIC, AND WHAT IT REFUSES
 * ---------------------------------------------------------------------------
 *
 *     E[net] = p × profitOnSuccess − (1 − p) × maxLoss
 *
 * Two terms, and the second one is the half that most "expected value" code
 * omits. Dropping it produces a number that rises monotonically with optimism
 * and never with prudence, which is how a 2%-chance moonshot outranks a
 * reliable small win. The downside is not a risk adjustment bolted on
 * afterwards; it is half the expectation.
 *
 * REQUIRED INPUTS ARE REQUIRED. `p` and `maxLoss` and `profitOnSuccess` have no
 * defensible defaults — a missing probability is not 0.5, a missing worst case
 * is not zero — so an opportunity lacking any of them is UNRANKABLE, and the
 * result says which ones are missing. That refusal is the whole point: an
 * unresearched opportunity should produce a research task, not a rank.
 */

import { formatCents } from "@/lib/economic/money";
import { weakerBasis, type EstimateBasis } from "@/lib/economic/estimate";
import { EV_MATERIAL_FIGURES, type CapitalBasisAssessment } from "@/lib/economic/figures";
import type {
  FigureProvenance,
  OpportunityDimensions,
  OpportunityModelView,
} from "@/lib/economic/opportunityModel";
import type { EconomicFigure } from "@/generated/prisma/enums";

/** The longest horizon a per-day rate is computed over. */
export const MAX_HORIZON_DAYS = 365;

/**
 * The shortest horizon a per-day rate is computed over.
 *
 * One day. A "same day" opportunity would otherwise divide by zero and produce
 * an infinite rate, which would sort to the top of every list forever.
 */
export const MIN_HORIZON_DAYS = 1;

export interface ExpectedValueTerms {
  /** p, as used. 0-1. */
  probability: number;
  /** Net profit if it works, in cents. */
  profitOnSuccessCents: number;
  /** Worst realistic loss if it does not, in cents. Non-negative. */
  maxLossCents: number;
  /** Capital that must be deployed, when known. */
  requiredCapitalCents: number | null;
  horizonDays: number;
}

export interface RankableExpectation {
  rankable: true;
  opportunityId: string;
  /**
   * p × profit − (1 − p) × loss, in cents. CAN BE NEGATIVE, and a negative
   * expectation is the single most useful output here: it is the arithmetic
   * saying "do not do this", which is what stops capital going to opportunities
   * that merely sound exciting.
   */
  expectedNetCents: number;
  /**
   * Expected net per day over the horizon.
   *
   * THE COMPARABLE RATE. A $2,000 expectation over 90 days and a $300
   * expectation over 7 days are not comparable as totals and are immediately
   * comparable as rates — which is the only way a slow high-ceiling build can
   * be weighed against a fast cheap test. It is also the figure a long-term
   * profit-per-day target is denominated in.
   */
  expectedNetPerDayCents: number;
  /**
   * Expected net divided by capital required. Null when capital is unknown or
   * zero — not Infinity, and not a large number standing in for one.
   */
  expectedReturnOnCapital: number | null;
  terms: ExpectedValueTerms;
  /**
   * The weakest basis among the figures that entered the arithmetic.
   *
   * [P6-B] A DERIVED LABEL FOR SURFACES, NOT THE RECORD. It is the minimum over
   * `provenance.figures`, which is the authoritative per-figure account. Nothing
   * may read this field and conclude anything about an individual figure — that
   * is the inference P6-B exists to make impossible — and in particular no
   * figure's own basis is ever set from it.
   */
  basis: EstimateBasis;
  /**
   * Whether this opportunity's figures are collectively strong enough to justify
   * committing real money.
   *
   * [P6-B] Now `provenance.capital.eligible`: EVERY ev-material figure must
   * clear the bar on its OWN basis. Previously this was one comparison against
   * one rolled-up basis, which gave the same answer in the common case and could
   * not say which figure was responsible.
   */
  capitalEligible: boolean;
  /** [P6-B] Per-figure provenance for exactly the figures that entered. */
  provenance: ExpectationProvenance;
  /** One sentence, for a surface. States the basis alongside the number. */
  summary: string;
}

/**
 * [P6-B] WHICH FIGURES THIS EXPECTATION RESTS ON, AND HOW WELL EACH IS EVIDENCED.
 *
 * Carried on the expectation itself so that a decision taken from the number can
 * be audited without re-reading the opportunity: the figures here are the ones
 * that ACTUALLY entered the arithmetic, in the state they were in when it ran.
 */
export interface ExpectationProvenance {
  /** One entry per ev-material figure, whether or not it is known. */
  figures: {
    figure: EconomicFigure;
    label: string;
    basis: EstimateBasis;
    value: number | null;
    /** True when it came from an `OpportunityEstimate` row or a measurement. */
    authoritative: boolean;
    provenance: string;
    establishedAt: Date | null;
  }[];
  /** The capital gate's verdict, with the blocking figures named. */
  capital: CapitalBasisAssessment;
  /** The figures still resting on the legacy column path. */
  compatibilityFigures: EconomicFigure[];
}

export interface UnrankableExpectation {
  rankable: false;
  opportunityId: string;
  /** Exactly which dimensions have no basis. The research task, named. */
  missing: (keyof OpportunityDimensions)[];
  reason: string;
}

/**
 * NOTE WHAT THE UNRANKABLE ARM DOES NOT CARRY: no `expectedNetCents`, no score,
 * no placeholder. There is no field for a caller to sort on, so an unresearched
 * opportunity cannot accidentally be ordered against a researched one.
 */
export type Expectation = RankableExpectation | UnrankableExpectation;

export function isRankable(expectation: Expectation): expectation is RankableExpectation {
  return expectation.rankable;
}

/**
 * Computes the expectation, or refuses and says what is missing.
 */
export function expectedValueOf(model: OpportunityModelView): Expectation {
  const { dimensions, opportunityId } = model;
  const missing: (keyof OpportunityDimensions)[] = [];

  const probability = dimensions.probabilityOfSuccess;
  const profit = dimensions.expectedProfitCents;
  const maxLoss = dimensions.maxLossCents;

  if (!probability.known) missing.push("probabilityOfSuccess");
  if (!profit.known) missing.push("expectedProfitCents");
  if (!maxLoss.known) missing.push("maxLossCents");

  if (!probability.known || !profit.known || !maxLoss.known) {
    return {
      rankable: false,
      opportunityId,
      missing,
      reason:
        "This opportunity cannot be ranked by expected profit yet. A probability, an expected profit and a worst-case loss all have to be established first — and none of the three has a defensible default, so guessing one would produce a rank that looks exactly like a researched one.",
    };
  }

  // Clamped rather than rejected: a probability outside 0-1 is a data error, and
  // clamping keeps the arithmetic total while the basis still reports where the
  // number came from. A negative loss would flip the sign of the downside term,
  // so it is floored at zero.
  const p = Math.min(1, Math.max(0, probability.value));
  const profitOnSuccessCents = Math.round(profit.value);
  const maxLossCents = Math.max(0, Math.round(maxLoss.value));

  const horizonDays = dimensions.timeToPayoutDays.known
    ? Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.round(dimensions.timeToPayoutDays.value)))
    : // A horizon nobody established defaults to the longest one considered, so
      // an unknown time-to-result makes the per-day rate CONSERVATIVE rather
      // than flattering. This is the one default in the module, and it is
      // chosen to understate rather than overstate.
      MAX_HORIZON_DAYS;

  const requiredCapitalCents = dimensions.requiredCapitalCents.known
    ? Math.max(0, Math.round(dimensions.requiredCapitalCents.value))
    : null;

  const expectedNetCents = Math.round(p * profitOnSuccessCents - (1 - p) * maxLossCents);
  const expectedNetPerDayCents = Math.round(expectedNetCents / horizonDays);
  const expectedReturnOnCapital =
    requiredCapitalCents !== null && requiredCapitalCents > 0 ? expectedNetCents / requiredCapitalCents : null;

  // [P6-B] PER-FIGURE, not a roll-up. The capital verdict comes from the gate,
  // which checks each ev-material figure against its own basis and names the
  // ones that fall short; `basis` below is only the weakest of them, computed
  // for display and never fed back into any figure.
  const provenance = expectationProvenance(model);
  const basis = weakestEnteredBasis(model);
  const capitalEligible = provenance.capital.eligible;

  return {
    rankable: true,
    opportunityId,
    expectedNetCents,
    expectedNetPerDayCents,
    expectedReturnOnCapital,
    terms: { probability: p, profitOnSuccessCents, maxLossCents, requiredCapitalCents, horizonDays },
    basis,
    capitalEligible,
    provenance,
    summary:
      `Expected ${formatCents(expectedNetCents)} over ${horizonDays} day${horizonDays === 1 ? "" : "s"} ` +
      `(${Math.round(p * 100)}% chance of ${formatCents(profitOnSuccessCents)}, else −${formatCents(maxLossCents)})` +
      `. This is an estimate, not revenue, and its weakest input is ${describeWeakestFigure(model)}.`,
  };
}

/**
 * The ev-material figures, in registry order, exactly as they stood.
 *
 * INCLUDES THE UNKNOWN ONES. A figure nobody has established is part of the
 * provenance of the expectation — it is the reason the capital gate refuses —
 * and dropping it from the list would make the record read as though every
 * figure it mentions were the complete set.
 */
function expectationProvenance(model: OpportunityModelView): ExpectationProvenance {
  return {
    figures: EV_MATERIAL_FIGURES.map((figure) => {
      const p: FigureProvenance = model.figures[figure];
      return {
        figure,
        label: p.label,
        basis: p.basis,
        value: p.value,
        authoritative: p.authoritative,
        provenance: p.provenance,
        establishedAt: p.establishedAt,
      };
    }),
    capital: model.capital,
    compatibilityFigures: model.compatibilityFigures,
  };
}

/** The weakest basis among the known ev-material figures. For display only. */
function weakestEnteredBasis(model: OpportunityModelView): EstimateBasis {
  return EV_MATERIAL_FIGURES.map((f) => model.figures[f])
    .filter((p) => p.value !== null)
    .reduce<EstimateBasis>((worst, p) => weakerBasis(worst, p.basis), "MEASURED");
}

/** Names the figure AND its basis, so a surface says what to go and improve. */
function describeWeakestFigure(model: OpportunityModelView): string {
  const weakest = EV_MATERIAL_FIGURES.map((f) => model.figures[f])
    .filter((p) => p.value !== null)
    .reduce<FigureProvenance | null>(
      // Strictly weaker, so a tie keeps the earlier figure in registry order and
      // the same opportunity always names the same figure.
      (worst, p) =>
        worst === null || (p.basis !== worst.basis && weakerBasis(p.basis, worst.basis) === p.basis) ? p : worst,
      null
    );
  if (weakest === null) return "nothing — no figure that enters the expectation is established";
  return `the ${weakest.label} (${weakest.basis.toLowerCase().replace("_", " ")})`;
}

/**
 * Ranks by expected net PER DAY, descending.
 *
 * Per day rather than per opportunity, because total expectation systematically
 * favours whatever has the longest horizon — a year-long project with a modest
 * expectation would outrank a week-long test with a better one, and VOX would
 * spend its time on the slower thing.
 *
 * UNRANKABLE OPPORTUNITIES ARE NOT SORTED TO THE BOTTOM. They are returned
 * separately, because putting them last implies they are worse, when what is
 * actually true is that nobody knows — and some of them will be the best things
 * in the list once somebody looks.
 */
export function rankByExpectedValue(expectations: readonly Expectation[]): {
  ranked: RankableExpectation[];
  unrankable: UnrankableExpectation[];
} {
  const ranked = expectations.filter(isRankable).sort((a, b) => {
    if (b.expectedNetPerDayCents !== a.expectedNetPerDayCents) {
      return b.expectedNetPerDayCents - a.expectedNetPerDayCents;
    }
    // Tie-break on capital efficiency, then on a stable id, so an unchanged set
    // of inputs always produces an identical order.
    const aRoc = a.expectedReturnOnCapital ?? -Infinity;
    const bRoc = b.expectedReturnOnCapital ?? -Infinity;
    if (bRoc !== aRoc) return bRoc - aRoc;
    return a.opportunityId.localeCompare(b.opportunityId);
  });

  return { ranked, unrankable: expectations.filter((e): e is UnrankableExpectation => !e.rankable) };
}

/**
 * The opportunity cost of taking `chosen` instead of the best alternative.
 *
 * Reported in the same per-day cents the ranking uses. Zero when there is no
 * alternative — which is a real answer, not a missing one.
 */
export function opportunityCostPerDayCents(
  chosen: RankableExpectation,
  all: readonly RankableExpectation[]
): number {
  const best = all
    .filter((e) => e.opportunityId !== chosen.opportunityId)
    .reduce<number | null>((max, e) => (max === null ? e.expectedNetPerDayCents : Math.max(max, e.expectedNetPerDayCents)), null);
  if (best === null) return 0;
  return Math.max(0, best - chosen.expectedNetPerDayCents);
}
