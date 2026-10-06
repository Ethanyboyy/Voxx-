/**
 * [P6-A] ONE MODEL EVERY OPPORTUNITY IS COMPARED THROUGH.
 * [P6-B] WITH PROVENANCE ATTACHED TO EACH FIGURE RATHER THAN TO THE ROW.
 *
 * The problem this solves: VOX is meant to compare a dropshipping test against
 * an affiliate page against a micro-SaaS against a licensing deal. Those have
 * nothing in common as businesses. What they DO have in common is a small set
 * of economic dimensions — what it costs, what it might return, how likely that
 * is, how long until you find out, and how much you can lose — and comparing
 * them on anything else is comparing their marketing.
 *
 * So this module projects an `Opportunity` onto those dimensions and attaches a
 * BASIS to each one. Nothing is stored here; nothing is invented; the category
 * stays free text so the taxonomy is open — an opportunity kind nobody
 * anticipated normalizes exactly like one that was.
 *
 * ---------------------------------------------------------------------------
 * [P6-B] WHAT CHANGED, AND WHY IT HAD TO
 * ---------------------------------------------------------------------------
 *
 * P6-A derived every figure's basis from ONE column:
 *
 *     const stated = statedBasisFor(opportunity.source);   // then used 7 times
 *
 * Provenance was a property of the ROW. That was wrong in both directions at
 * once. A person who corrected a model's invented revenue figure could not make
 * it count, because the row's discovery source had not changed. And one
 * genuinely measured figure could not exist alongside six invented ones, because
 * they all read the same column — so "the profit is measured but the capital
 * requirement is a guess" was literally unrepresentable.
 *
 * Provenance is now a property of the NUMBER. Each figure resolves independently
 * from `OpportunityEstimate` (authoritative), and the old column heuristic
 * survives only as `legacyColumnBasis()` — a clearly-marked compatibility path
 * that can never claim the two strongest bases.
 *
 * THE PROBABILITY DIMENSION IS STILL THE INTERESTING ONE. It prefers VOX's OWN
 * measured track record — `getMeasuredProbability()` from P5-C, over reconciled
 * experiment verdicts — whenever that is strictly better evidenced than what has
 * been recorded. That is the one place a forecast input is `MEASURED` without
 * anybody writing it down, and it exists because P5-D through P5-F built the
 * loop that produces it.
 */

import { db } from "@/lib/db";
import { getMeasuredProbability } from "@/lib/economic/probability";
import {
  canInfluenceCapital,
  isValidBasisUpgrade,
  known,
  unknown,
  weakerBasis,
  type Estimate,
  type EstimateBasis,
  type KnownBasis,
} from "@/lib/economic/estimate";
import {
  ECONOMIC_FIGURES,
  FIGURE_SPECS,
  capitalBasisGate,
  figureValueOf,
  type CapitalBasisAssessment,
} from "@/lib/economic/figures";
import { listEstimates, listEstimatesForOpportunities } from "@/lib/economic/provenance";
import type { EconomicFigure, EvidenceBasis } from "@/generated/prisma/enums";
import type { Opportunity, OpportunityEstimate, RiskLevel } from "@/generated/prisma/client";

/**
 * A LOW/MEDIUM/HIGH magnitude, reusing the existing `RiskLevel` enum exactly as
 * `Opportunity.scalability` already does — as a three-point scale, not a risk
 * judgement. A fourth vocabulary for "how much" is a fourth thing to drift.
 */
export type Magnitude = RiskLevel;

/** Turned into a number ONLY where a bounded multiplier is wanted, never as a score. */
const MAGNITUDE_FRACTION: Readonly<Record<Magnitude, number>> = Object.freeze({
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
});

export function magnitudeFraction(m: Magnitude): number {
  return MAGNITUDE_FRACTION[m];
}

/**
 * The dimensions every opportunity is compared on, whatever it actually is.
 *
 * Money is in CENTS throughout, matching the ledger — see `economic/money.ts`
 * for why a float monetary comparison at a boundary is a coin flip.
 */
export interface OpportunityDimensions {
  /** Gross revenue the opportunity might produce over its payout horizon. */
  expectedRevenueCents: Estimate<number>;
  /** Net profit on success. Preferred over revenue × margin when stated directly. */
  expectedProfitCents: Estimate<number>;
  /** Capital that has to be deployed for it to run at all. */
  requiredCapitalCents: Estimate<number>;
  /** 0-1 share of revenue retained. Used only to DERIVE profit when it is absent. */
  marginFraction: Estimate<number>;
  /** 0-1. Measured from VOX's own reconciled verdicts where any exist. */
  probabilityOfSuccess: Estimate<number>;
  /** Worst realistic loss, in cents. The downside half of the expectation. */
  maxLossCents: Estimate<number>;
  /** Days until the result is knowable. The denominator that makes rates comparable. */
  timeToPayoutDays: Estimate<number>;

  // --- Ordinal dimensions. Not money, and never multiplied into one. ---
  scalability: Estimate<Magnitude>;
  competition: Estimate<Magnitude>;
  complexity: Estimate<Magnitude>;
  /** How much of the user's own time it needs. High involvement is a real cost. */
  humanInvolvement: Estimate<Magnitude>;
}

/** Which `EconomicFigure` backs each monetary/ratio/duration dimension. */
export const DIMENSION_FIGURE: Readonly<Record<string, EconomicFigure>> = Object.freeze({
  expectedRevenueCents: "EXPECTED_REVENUE_CENTS",
  expectedProfitCents: "EXPECTED_PROFIT_CENTS",
  requiredCapitalCents: "REQUIRED_CAPITAL_CENTS",
  marginFraction: "MARGIN_FRACTION",
  probabilityOfSuccess: "PROBABILITY_OF_SUCCESS",
  maxLossCents: "MAX_LOSS_CENTS",
  timeToPayoutDays: "TIME_TO_PAYOUT_DAYS",
});

/** The reverse map, so a figure can name the dimension a surface already shows. */
export const FIGURE_DIMENSION: Readonly<Record<EconomicFigure, keyof OpportunityDimensions>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(DIMENSION_FIGURE).map(([dimension, figure]) => [figure, dimension])
    ) as Record<EconomicFigure, keyof OpportunityDimensions>
  );

/**
 * WHERE a figure's value and basis actually came from.
 *
 * Four real sources and an absence. The distinction that matters most is
 * `ESTIMATE` versus `LEGACY_COLUMN`: the first is a row somebody deliberately
 * wrote, carrying its own evidence references; the second is a bare column read
 * through a heuristic about the opportunity's discovery source, and it is
 * reported as non-authoritative precisely so it cannot be mistaken for the first.
 */
export type FigureSource =
  /** An `OpportunityEstimate` row. THE authoritative source of provenance. */
  | "ESTIMATE"
  /** VOX's own reconciled experiment verdicts. Probability only. */
  | "MEASUREMENT"
  /** Computed from other figures. Carries its weakest input's basis. */
  | "DERIVED"
  /** The P6-A compatibility path over `Opportunity`'s own columns. */
  | "LEGACY_COLUMN"
  /** Nothing establishes it. */
  | "NONE";

export interface FigureEvidence {
  experimentId: string | null;
  measurementId: string | null;
  researchItemId: string | null;
  comparableId: string | null;
}

/**
 * One figure, and the six things the brief requires every figure to answer:
 * what it is, what it is worth, how well that is evidenced, where the basis came
 * from, when it was established, and what evidence supports it.
 */
export interface FigureProvenance {
  figure: EconomicFigure;
  /** What the figure is, for a surface. */
  label: string;
  /** The value actually used, in the figure's own unit. Null when unknown. */
  value: number | null;
  basis: EstimateBasis;
  /** Where the basis came from, in words. */
  provenance: string;
  /**
   * When the basis was established.
   *
   * Null for a legacy column, and that null is informative: the old columns
   * carry no record of when anybody decided the number, which is one of the
   * reasons they are not authoritative.
   */
  establishedAt: Date | null;
  source: FigureSource;
  /**
   * False for a legacy column, and for anything derived from one.
   *
   * A non-authoritative basis is still USED — refusing to read the existing
   * columns would make every pre-P6-B opportunity unfundable overnight — but it
   * is capped at `STATED` (see `legacyColumnBasis`), so the compatibility path
   * can never manufacture the two strongest bases in the system.
   */
  authoritative: boolean;
  evidence: FigureEvidence | null;
  /** The `OpportunityEstimate` row's id, when one backs this figure. */
  estimateId: string | null;
  /** The basis this figure held before, when it has been changed. */
  previousBasis: EvidenceBasis | null;
  /** Why it is not known, when it is not. Null otherwise. */
  why: string | null;
  /** Whether THIS figure's own basis clears the capital minimum. */
  capitalEligible: boolean;
}

export interface OpportunityModelView {
  opportunityId: string;
  title: string;
  /** Free text, open-ended. "dropshipping", "micro-saas", anything VOX finds. */
  category: string | null;
  /** Where it came from: "user", a tool name, an agent. */
  source: string | null;
  status: Opportunity["status"];
  dimensions: OpportunityDimensions;
  /**
   * [P6-B] PER-FIGURE PROVENANCE. The authoritative record.
   *
   * This replaced a single `monetaryBasis: EstimateBasis` roll-up. The roll-up
   * answered "how well evidenced is this opportunity", which is not a question
   * with an answer — an opportunity is a bundle of separate claims, and
   * compressing them to their minimum threw away the only part a person could
   * act on: which claim is the weak one.
   */
  figures: Readonly<Record<EconomicFigure, FigureProvenance>>;
  /**
   * Whether this opportunity's figures may commit capital, and what blocks it.
   *
   * Derived on every read from the figures above — never stored. A persisted
   * "fundable" flag is a flag somebody can set; a derivation means the only way
   * to make an opportunity fundable is to improve its evidence.
   */
  capital: CapitalBasisAssessment;
  /** Figures still resting on the legacy column path, by name. */
  compatibilityFigures: EconomicFigure[];
  /** Every dimension that is not known, by name. What to go and find out. */
  missing: (keyof OpportunityDimensions)[];
}

/** Which dimensions must be known before an expectation can be computed at all. */
export const REQUIRED_FOR_EXPECTATION: readonly (keyof OpportunityDimensions)[] = Object.freeze([
  "probabilityOfSuccess",
  "maxLossCents",
] as const);

/**
 * Sources that mean "a person put their own knowledge behind this".
 *
 * Used ONLY by `legacyColumnBasis()` below.
 */
export const HUMAN_SOURCES: readonly string[] = Object.freeze(["user", "human", "owner", "manual"]);

/**
 * Whether a discovery source means "a person put their own knowledge behind
 * this".
 *
 * [P6-C] Exported so automated discovery can ASSERT that its own source is not
 * one of these, against the single definition rather than a copy. A copied list
 * is a list that drifts, and the drift here would be silent: an automated pass
 * whose source happened to match would have every legacy-read figure on its
 * rows promoted to STATED, which is capital-eligible.
 */
export function isHumanSource(source: string | null): boolean {
  if (source === null) return true;
  const trimmed = source.trim().toLowerCase();
  // An empty source reads as human below, so it reads as human here too.
  return trimmed.length === 0 || HUMAN_SOURCES.includes(trimmed);
}

/**
 * [P6-B] THE COMPATIBILITY PATH. NOT A SOURCE OF PROVENANCE.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT REPLACED IT
 * ---------------------------------------------------------------------------
 *
 * `Opportunity` has one `source` column, describing how the opportunity was
 * DISCOVERED. It says nothing about any individual figure on the row. P6-A used
 * it as a proxy for every figure's provenance because there was nothing else;
 * this function is what remains of that, and it is now the LAST resort, consulted
 * only for a figure that has no `OpportunityEstimate` row.
 *
 *   THE REPLACEMENT PATH: `recordEstimate()` in `economic/provenance.ts`, which
 *   writes an `OpportunityEstimate` row per figure, with its own basis, its own
 *   `establishedAt`, and foreign-key references to the evidence behind it. Once
 *   a figure has a row, this function is not consulted for that figure at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CEILING IS `STATED`
 * ---------------------------------------------------------------------------
 *
 * A value in a column is not a measurement and is not a comparable, whoever
 * typed it — there is no evidence reference attached, so there is nothing to
 * check. So the two strongest bases are unreachable from here BY CONSTRUCTION,
 * and the only way a figure becomes `COMPARABLE` or `MEASURED` is a row that
 * names the measurement or the opportunity it came from, which the database
 * then verifies exists.
 *
 * The conservative direction is kept from P6-A: a row discovered by anything
 * other than a person reads as `MODEL_SUGGESTED` until it is corroborated. That
 * can understate a figure a person later confirmed, and understating is the safe
 * error — it asks for corroboration rather than releasing capital.
 */
export function legacyColumnBasis(source: string | null): "STATED" | "MODEL_SUGGESTED" {
  // No source recorded at all reads as human, because the pre-P4-F rows and
  // everything a person creates through the UI legitimately have none, and
  // assuming a model wrote them would block capital on every older row.
  return isHumanSource(source) ? "STATED" : "MODEL_SUGGESTED";
}

// ---------------------------------------------------------------------------
// Resolving one figure
// ---------------------------------------------------------------------------

/** A candidate reading for a figure, before precedence is applied. */
interface Candidate {
  value: number;
  basis: KnownBasis;
  provenance: string;
  source: FigureSource;
  establishedAt: Date | null;
  authoritative: boolean;
  evidence: FigureEvidence | null;
  estimateId: string | null;
  previousBasis: EvidenceBasis | null;
}

function fromEstimateRow(figure: EconomicFigure, row: OpportunityEstimate): Candidate | null {
  const value = figureValueOf(figure, row);
  // A malformed row — the wrong value column set for the figure's kind — is
  // reported as UNKNOWN rather than quietly falling back to the legacy column.
  // Falling back would answer with a different number than the one on record,
  // and an unknown figure refuses capital while a substituted one spends it.
  if (value === null) return null;
  return {
    value,
    basis: row.basis,
    provenance: row.provenance,
    source: "ESTIMATE",
    establishedAt: row.establishedAt,
    authoritative: true,
    evidence: {
      experimentId: row.experimentId,
      measurementId: row.measurementId,
      researchItemId: row.researchItemId,
      comparableId: row.comparableId,
    },
    estimateId: row.id,
    previousBasis: row.previousBasis,
  };
}

function fromLegacyColumn(
  figure: EconomicFigure,
  value: number | null | undefined,
  source: string | null
): Candidate | null {
  if (value === null || value === undefined) return null;
  const spec = FIGURE_SPECS[figure];
  return {
    value,
    basis: legacyColumnBasis(source),
    provenance: `${spec.legacyColumn} on the opportunity row (no per-figure estimate recorded)`,
    source: "LEGACY_COLUMN",
    establishedAt: null,
    authoritative: false,
    evidence: null,
    estimateId: null,
    previousBasis: null,
  };
}

function resolved(figure: EconomicFigure, candidate: Candidate): FigureProvenance {
  return {
    figure,
    label: FIGURE_SPECS[figure].label,
    value: candidate.value,
    basis: candidate.basis,
    provenance: candidate.provenance,
    establishedAt: candidate.establishedAt,
    source: candidate.source,
    authoritative: candidate.authoritative,
    evidence: candidate.evidence,
    estimateId: candidate.estimateId,
    previousBasis: candidate.previousBasis,
    why: null,
    capitalEligible: canInfluenceCapital(candidate.basis),
  };
}

function unresolved(figure: EconomicFigure, why: string): FigureProvenance {
  return {
    figure,
    label: FIGURE_SPECS[figure].label,
    value: null,
    basis: "NONE",
    provenance: "nothing establishes this figure",
    establishedAt: null,
    source: "NONE",
    authoritative: false,
    evidence: null,
    estimateId: null,
    previousBasis: null,
    why,
    // An absent figure is never capital-eligible. It is not a zero.
    capitalEligible: false,
  };
}

/** Lifts a resolved figure into the `Estimate<number>` the arithmetic consumes. */
function toEstimate(p: FigureProvenance): Estimate<number> {
  return p.value === null || p.basis === "NONE"
    ? unknown(p.why ?? `no basis has been established for the ${p.label}`)
    : known(p.value, p.basis, p.provenance);
}

function magnitudeOf(
  value: RiskLevel | null,
  basis: "STATED" | "MODEL_SUGGESTED",
  provenance: string,
  why: string
): Estimate<Magnitude> {
  // The ordinals have no `EconomicFigure` and therefore no per-figure
  // provenance, which is correct: they are not economically material, they never
  // enter the expectation, and they cannot lift or lower any money figure's
  // basis. They stay on the legacy column path until something needs them to be
  // more than an assessment.
  return value === null ? unknown(why) : known(value, basis, provenance);
}

export interface ProjectOpportunityOptions {
  /** VOX's own reconciled verdicts, from `getMeasuredProbability()`. */
  measuredProbability?: { probability: number | null; decided: number } | null;
  /** The authoritative per-figure records, by figure. */
  estimates?: Partial<Record<EconomicFigure, OpportunityEstimate>>;
}

/**
 * Projects one opportunity onto the common dimensions, with per-figure provenance.
 *
 * SYNCHRONOUS AND PURE. Both the measured probability and the estimate rows are
 * passed in rather than fetched, which is what lets the whole provenance table
 * be tested by enumeration instead of by staging database fixtures.
 *
 * The third parameter is optional so every P6-A caller keeps working: an
 * opportunity with no recorded estimates projects exactly as it did before,
 * through the compatibility path, flagged as such.
 */
export function projectOpportunity(
  opportunity: Opportunity,
  measuredProbability: { probability: number | null; decided: number } | null,
  estimates: Partial<Record<EconomicFigure, OpportunityEstimate>> = {}
): OpportunityModelView {
  const rowSource = opportunity.source;

  /**
   * The precedence rule, in one place.
   *
   * AN ESTIMATE ROW ALWAYS WINS OVER A LEGACY COLUMN, whatever its basis. A
   * deliberate `MODEL_SUGGESTED` recording must not be overridden by the
   * heuristic reading of the same column: the point of recording it was to say
   * that this number is a model's proposal, and letting the row's discovery
   * source quietly promote it back to `STATED` would be laundering.
   */
  const resolve = (figure: EconomicFigure, legacyValue: number | null | undefined, why: string): FigureProvenance => {
    const row = estimates[figure];
    if (row) {
      const candidate = fromEstimateRow(figure, row);
      if (candidate) return resolved(figure, candidate);
      return unresolved(
        figure,
        `the recorded estimate for the ${FIGURE_SPECS[figure].label} holds no value readable as ${FIGURE_SPECS[figure].kind.toLowerCase()}, so it is treated as unknown rather than read from the wrong column`
      );
    }
    const legacy = fromLegacyColumn(figure, legacyValue, rowSource);
    return legacy ? resolved(figure, legacy) : unresolved(figure, why);
  };

  // ---- PROBABILITY: VOX's own measured record, when it is better ----------
  //
  // `getMeasuredProbability()` returns null with no decided trials, and null
  // must stay null: a success rate over zero trials does not exist, and
  // substituting 0.5 here would be the `?? default` bug wearing a bell curve.
  //
  // PRECEDENCE: the recorded estimate wins UNLESS the measured track record is
  // STRICTLY better evidenced. A measurement VOX took itself outranks a figure
  // somebody stated; it does not override an equally-measured recording, which
  // names its own evidence and is therefore the more auditable of the two.
  const recordedProbability = resolve(
    "PROBABILITY_OF_SUCCESS",
    opportunity.probabilityOfSuccess,
    "no experiment has been reconciled for this opportunity and nobody has stated a probability"
  );
  const trackRecord =
    measuredProbability && measuredProbability.probability !== null && measuredProbability.decided > 0
      ? { probability: measuredProbability.probability, decided: measuredProbability.decided }
      : null;
  const probability: FigureProvenance =
    // "MEASURED would be an upgrade on what is recorded" — false when the
    // recorded figure is itself MEASURED, which is the tie the row wins.
    trackRecord && isValidBasisUpgrade(recordedProbability.basis, "MEASURED")
      ? resolved("PROBABILITY_OF_SUCCESS", {
          value: trackRecord.probability,
          basis: "MEASURED",
          provenance: `${trackRecord.decided} reconciled experiment verdict${trackRecord.decided === 1 ? "" : "s"} on this opportunity`,
          source: "MEASUREMENT",
          establishedAt: null,
          authoritative: true,
          evidence: null,
          estimateId: null,
          previousBasis: null,
        })
      : recordedProbability;

  const revenue = resolve(
    "EXPECTED_REVENUE_CENTS",
    opportunity.expectedRevenueCents,
    "no expected revenue has been established"
  );
  const margin = resolve("MARGIN_FRACTION", opportunity.estimatedMargin, "no margin has been established");

  // ---- PROFIT: recorded, derived, or read from the legacy column ----------
  //
  // Derived only when BOTH revenue and margin are known, and the derived figure
  // inherits the WEAKER of their two bases. Deriving from revenue alone would
  // mean assuming a margin, and an assumed margin on a dropshipping opportunity
  // is the difference between a business and a hobby.
  //
  // PRECEDENCE, which the per-figure world makes expressible for the first time:
  // a recorded profit estimate wins outright; otherwise the derivation and the
  // legacy column compete on their own bases, and a tie goes to the column
  // because a directly stated profit involves one fewer inference than one
  // multiplied out of two other numbers. So measured revenue × measured margin
  // now beats a stale legacy profit column, which under P6-A it could not.
  const derivedProfit: Candidate | null =
    revenue.value !== null && margin.value !== null && revenue.basis !== "NONE" && margin.basis !== "NONE"
      ? {
          value: Math.round(revenue.value * margin.value),
          basis: weakerBasis(revenue.basis, margin.basis) as KnownBasis,
          provenance: `derived from expected revenue × margin (${describeBasisPair(revenue, margin)})`,
          source: "DERIVED",
          // No fresher than its stalest input, and unknown if either input has
          // no recorded date at all.
          establishedAt:
            revenue.establishedAt && margin.establishedAt
              ? new Date(Math.min(revenue.establishedAt.getTime(), margin.establishedAt.getTime()))
              : null,
          // A derivation is only as authoritative as its inputs.
          authoritative: revenue.authoritative && margin.authoritative,
          evidence: null,
          estimateId: null,
          previousBasis: null,
        }
      : null;

  const profit = resolveProfit(opportunity, estimates, rowSource, derivedProfit);

  const figureMap: Record<EconomicFigure, FigureProvenance> = {
    REQUIRED_CAPITAL_CENTS: resolve(
      "REQUIRED_CAPITAL_CENTS",
      opportunity.requiredCapitalCents,
      "no capital requirement has been established"
    ),
    EXPECTED_REVENUE_CENTS: revenue,
    EXPECTED_PROFIT_CENTS: profit,
    MAX_LOSS_CENTS: resolve("MAX_LOSS_CENTS", opportunity.maxLossCents, "no worst-case loss has been established"),
    PROBABILITY_OF_SUCCESS: probability,
    MARGIN_FRACTION: margin,
    TIME_TO_PAYOUT_DAYS: resolve(
      "TIME_TO_PAYOUT_DAYS",
      opportunity.timeToPayoutDays ?? opportunity.estimatedTimeToRevenueDays,
      "no time-to-result has been established"
    ),
  };

  const ordinalBasis = legacyColumnBasis(rowSource);
  const dimensions: OpportunityDimensions = {
    expectedRevenueCents: toEstimate(figureMap.EXPECTED_REVENUE_CENTS),
    expectedProfitCents: toEstimate(figureMap.EXPECTED_PROFIT_CENTS),
    requiredCapitalCents: toEstimate(figureMap.REQUIRED_CAPITAL_CENTS),
    marginFraction: toEstimate(figureMap.MARGIN_FRACTION),
    probabilityOfSuccess: toEstimate(figureMap.PROBABILITY_OF_SUCCESS),
    maxLossCents: toEstimate(figureMap.MAX_LOSS_CENTS),
    timeToPayoutDays: toEstimate(figureMap.TIME_TO_PAYOUT_DAYS),
    scalability: magnitudeOf(opportunity.scalability, ordinalBasis, "scalability on the opportunity", "scalability is unassessed"),
    competition: magnitudeOf(opportunity.competition, ordinalBasis, "competition on the opportunity", "competition is unassessed"),
    complexity: magnitudeOf(opportunity.complexity, ordinalBasis, "complexity on the opportunity", "complexity is unassessed"),
    humanInvolvement: magnitudeOf(
      opportunity.requiredHumanInvolvement,
      ordinalBasis,
      "requiredHumanInvolvement on the opportunity",
      "required human involvement is unassessed"
    ),
  };

  const missing = (Object.keys(dimensions) as (keyof OpportunityDimensions)[]).filter(
    (key) => !dimensions[key].known
  );

  return {
    opportunityId: opportunity.id,
    title: opportunity.title,
    category: opportunity.category,
    source: opportunity.source,
    status: opportunity.status,
    dimensions,
    figures: Object.freeze(figureMap),
    capital: capitalBasisGate(
      ECONOMIC_FIGURES.map((figure) => ({
        figure,
        basis: figureMap[figure].basis,
        known: figureMap[figure].value !== null && figureMap[figure].basis !== "NONE",
      }))
    ),
    compatibilityFigures: ECONOMIC_FIGURES.filter((f) => !figureMap[f].authoritative && figureMap[f].value !== null),
    missing,
  };
}

/** Profit's three-way precedence, lifted out so the rule is readable. */
function resolveProfit(
  opportunity: Opportunity,
  estimates: Partial<Record<EconomicFigure, OpportunityEstimate>>,
  rowSource: string | null,
  derived: Candidate | null
): FigureProvenance {
  const row = estimates.EXPECTED_PROFIT_CENTS;
  if (row) {
    const candidate = fromEstimateRow("EXPECTED_PROFIT_CENTS", row);
    return candidate
      ? resolved("EXPECTED_PROFIT_CENTS", candidate)
      : unresolved(
          "EXPECTED_PROFIT_CENTS",
          "the recorded estimate for the expected profit holds no value readable as cents, so it is treated as unknown rather than read from the wrong column"
        );
  }

  const legacy = fromLegacyColumn("EXPECTED_PROFIT_CENTS", opportunity.expectedProfitCents, rowSource);
  if (legacy && derived) {
    // Tie goes to the column: one fewer inference.
    return resolved(
      "EXPECTED_PROFIT_CENTS",
      weakerBasis(derived.basis, legacy.basis) === legacy.basis ? legacy : derived
    );
  }
  if (legacy) return resolved("EXPECTED_PROFIT_CENTS", legacy);
  if (derived) return resolved("EXPECTED_PROFIT_CENTS", derived);
  return unresolved(
    "EXPECTED_PROFIT_CENTS",
    "expected profit was not stated, and it cannot be derived without both an expected revenue and a margin"
  );
}

function describeBasisPair(a: FigureProvenance, b: FigureProvenance): string {
  return [a, b].map((p) => p.basis.toLowerCase().replace("_", " ")).join(" + ");
}

/**
 * Loads and projects one opportunity, scoped by user.
 *
 * The `userId` is in the WHERE clause rather than checked after, following the
 * same tenant discipline as `resolveConnectionCredential()`.
 */
export async function getOpportunityModel(
  userId: string,
  opportunityId: string
): Promise<OpportunityModelView | null> {
  const opportunity = await db.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opportunity) return null;

  const [measured, estimates] = await Promise.all([
    getMeasuredProbability({ userId, opportunityId }),
    listEstimates(userId, opportunityId),
  ]);
  return projectOpportunity(opportunity, measured, estimates);
}

/**
 * Every opportunity worth comparing, projected.
 *
 * Estimates come back in ONE query for the whole set — per-figure provenance
 * must not cost a query per figure per opportunity, or the posture surface
 * becomes the slowest page in the application and somebody caches it.
 */
export async function listOpportunityModels(
  userId: string,
  options: { statuses?: Opportunity["status"][]; limit?: number } = {}
): Promise<OpportunityModelView[]> {
  const statuses = options.statuses ?? (["IDEA", "EVALUATING", "ACTIVE"] as Opportunity["status"][]);
  const opportunities = await db.opportunity.findMany({
    where: { userId, status: { in: statuses } },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 100,
  });
  if (opportunities.length === 0) return [];

  const estimatesByOpportunity = await listEstimatesForOpportunities(
    userId,
    opportunities.map((o) => o.id)
  );

  return Promise.all(
    opportunities.map(async (opportunity) =>
      projectOpportunity(
        opportunity,
        await getMeasuredProbability({ userId, opportunityId: opportunity.id }),
        estimatesByOpportunity.get(opportunity.id) ?? {}
      )
    )
  );
}
