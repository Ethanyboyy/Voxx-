/**
 * [P6-B] THE CLOSED SET OF ECONOMICALLY MATERIAL FIGURES.
 *
 * A leaf module: a frozen table and pure helpers, no database, no network. It
 * answers three questions that every other part of the provenance system asks,
 * and answers them in one place so they cannot drift:
 *
 *   WHICH FIGURES NEED THEIR OWN PROVENANCE?   the registry below
 *   WHAT KIND OF NUMBER IS EACH ONE?           `kind`, which column holds it
 *   WHICH ONES MOVE EXPECTED VALUE?            `materialToExpectedValue`
 *
 * The registry is closed for the same reason the observation registry and the
 * proposal registry are closed: a figure that can be invented at call time is a
 * figure whose provenance rules nobody reviewed. Adding one is a line in a diff.
 */

import { canInfluenceCapital, describeBasis, type EstimateBasis } from "@/lib/economic/estimate";
import type { EconomicFigure, EvidenceBasis } from "@/generated/prisma/enums";

/**
 * What sort of quantity a figure is, and therefore which column stores it.
 *
 * THREE KINDS RATHER THAN ONE NUMBER COLUMN, because the three have genuinely
 * different exactness requirements. Money is integer cents — a float monetary
 * comparison at a spend boundary is a coin flip (see `economic/money.ts`). A
 * ratio is a float because 0-1 fractions have no exact integer form. A duration
 * is whole days because half a day of time-to-result is not a thing anyone
 * means.
 */
export type FigureKind = "CENTS" | "RATIO" | "DAYS";

export interface FigureSpec {
  kind: FigureKind;
  /** What the figure is, for a surface. */
  label: string;
  /**
   * True when this figure appears in `E[net] = p × profit − (1−p) × maxLoss`
   * or in the capital constraint.
   *
   * THIS IS THE FLAG THAT DECIDES WHAT MUST BE WELL-FOUNDED BEFORE MONEY MOVES.
   * A figure that does not move expected value can be model-suggested without
   * consequence; one that does cannot.
   */
  materialToExpectedValue: boolean;
  /**
   * True when this figure's ABSENCE is handled by a default that can only
   * understate the expectation.
   *
   * WHY THIS IS A SEPARATE FLAG FROM `materialToExpectedValue`. The capital gate
   * refuses a figure whose basis is too weak, and it has to decide what to do
   * about a figure that is missing entirely. For almost everything, missing is
   * fatal: there is no honest default for a probability, a profit, a worst case,
   * or a bill. For the horizon there is one — `MAX_HORIZON_DAYS`, the longest
   * horizon considered — and substituting it makes the per-day rate SMALLER, so
   * an unestablished horizon can only rank an opportunity lower than it deserves.
   *
   * A figure that cannot flatter the result by being absent does not need to
   * block capital by being absent. Note the asymmetry, which is the point: a
   * horizon that is PRESENT on a weak basis still blocks, because a
   * model-suggested "7 days" where the truth is a year inflates the rate 52×.
   */
  absenceIsConservative: boolean;
  /**
   * The legacy `Opportunity` column this figure used to be read from.
   *
   * Retained ONLY for the compatibility path in `opportunityModel.ts`, which is
   * explicitly non-authoritative. Named here so the mapping between the old
   * column world and the new estimate world is written down once.
   */
  legacyColumn: string;
  /**
   * A SECOND `Opportunity` column the compatibility path falls back to.
   *
   * Only `TIME_TO_PAYOUT_DAYS` has one (`estimatedTimeToRevenueDays`, which
   * predates the economic columns). Declared here rather than left implicit in
   * `opportunityModel.ts` so `LEGACY_ECONOMIC_COLUMNS` below is the COMPLETE
   * set of columns a write could use to reach the compatibility path — a
   * fallback column missing from that set is a hole an automated writer could
   * walk through.
   */
  legacyFallbackColumn?: string;
}

export const FIGURE_SPECS: Readonly<Record<EconomicFigure, FigureSpec>> = Object.freeze({
  REQUIRED_CAPITAL_CENTS: Object.freeze({
    kind: "CENTS",
    label: "capital required",
    materialToExpectedValue: true,
    absenceIsConservative: false,
    legacyColumn: "requiredCapitalCents",
  }),
  EXPECTED_REVENUE_CENTS: Object.freeze({
    kind: "CENTS",
    label: "expected revenue",
    // Not directly in the expectation — profit is. Revenue matters only as an
    // input to deriving profit, and the derived figure carries its own basis.
    materialToExpectedValue: false,
    absenceIsConservative: false,
    legacyColumn: "expectedRevenueCents",
  }),
  EXPECTED_PROFIT_CENTS: Object.freeze({
    kind: "CENTS",
    label: "expected profit on success",
    materialToExpectedValue: true,
    absenceIsConservative: false,
    legacyColumn: "expectedProfitCents",
  }),
  MAX_LOSS_CENTS: Object.freeze({
    kind: "CENTS",
    label: "worst-case loss",
    materialToExpectedValue: true,
    absenceIsConservative: false,
    legacyColumn: "maxLossCents",
  }),
  PROBABILITY_OF_SUCCESS: Object.freeze({
    kind: "RATIO",
    label: "probability of success",
    materialToExpectedValue: true,
    absenceIsConservative: false,
    legacyColumn: "probabilityOfSuccess",
  }),
  MARGIN_FRACTION: Object.freeze({
    kind: "RATIO",
    label: "margin",
    materialToExpectedValue: false,
    absenceIsConservative: false,
    legacyColumn: "estimatedMargin",
  }),
  TIME_TO_PAYOUT_DAYS: Object.freeze({
    kind: "DAYS",
    label: "time to result",
    // The per-day normaliser. It cannot make a bad expectation good, but it
    // decides the RATE every ranking is ordered by, so it is material.
    materialToExpectedValue: true,
    absenceIsConservative: true,
    legacyColumn: "timeToPayoutDays",
    legacyFallbackColumn: "estimatedTimeToRevenueDays",
  }),
});

export const ECONOMIC_FIGURES: readonly EconomicFigure[] = Object.freeze(
  Object.keys(FIGURE_SPECS) as EconomicFigure[]
);

/** The figures that must be well-founded before capital may be committed. */
export const EV_MATERIAL_FIGURES: readonly EconomicFigure[] = Object.freeze(
  ECONOMIC_FIGURES.filter((f) => FIGURE_SPECS[f].materialToExpectedValue)
);

/**
 * [P6-C] EVERY `Opportunity` COLUMN THE COMPATIBILITY PATH READS.
 *
 * The list an automated writer must not touch. Writing an economic figure into
 * one of these columns routes it through `legacyColumnBasis()`, which reads a
 * row with no `source` — or a human-looking one — as `STATED`, and `STATED` is
 * capital-eligible. So a discovery pass that filled in `expectedProfitCents`
 * "just for compatibility" would have promoted its own invention to a basis
 * that can reserve money, without touching the provenance layer at all.
 *
 * DERIVED from the registry rather than typed out, so a figure added above
 * cannot be forgotten here.
 */
export const LEGACY_ECONOMIC_COLUMNS: readonly string[] = Object.freeze(
  ECONOMIC_FIGURES.flatMap((figure) =>
    [FIGURE_SPECS[figure].legacyColumn, FIGURE_SPECS[figure].legacyFallbackColumn].filter(
      (column): column is string => column !== undefined
    )
  )
);

export function figureSpec(figure: EconomicFigure): FigureSpec {
  return FIGURE_SPECS[figure];
}

/**
 * The value columns for one figure, with exactly one set.
 *
 * Returning the whole triple rather than a single number is deliberate: the
 * caller writes all three columns, and building them here means the "exactly
 * one is set" rule is applied in one function instead of at every write site.
 */
export interface FigureValueColumns {
  valueCents: number | null;
  valueRatio: number | null;
  valueDays: number | null;
}

export type FigureValueError =
  | "NOT_A_NUMBER"
  /** Money and days must be whole. A fractional cent is not a representable amount. */
  | "NOT_AN_INTEGER"
  /** A ratio outside 0-1, a negative amount, a non-positive duration. */
  | "OUT_OF_RANGE";

export type FigureValueResult =
  | { valid: true; columns: FigureValueColumns }
  | { valid: false; error: FigureValueError };

/**
 * Validates a raw value against its figure's kind and builds the columns.
 *
 * STRICT, and every rejection below is something that would otherwise become a
 * plausible wrong number rather than an error: a fractional cent, a probability
 * of 1.4, a negative worst-case loss (which would flip the sign of the downside
 * term in the expectation), a zero-day horizon (which would divide by zero in
 * the per-day rate).
 */
export function figureValueColumns(figure: EconomicFigure, value: unknown): FigureValueResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { valid: false, error: "NOT_A_NUMBER" };
  }

  switch (FIGURE_SPECS[figure].kind) {
    case "CENTS":
      if (!Number.isInteger(value)) return { valid: false, error: "NOT_AN_INTEGER" };
      if (value < 0) return { valid: false, error: "OUT_OF_RANGE" };
      return { valid: true, columns: { valueCents: value, valueRatio: null, valueDays: null } };
    case "RATIO":
      if (value < 0 || value > 1) return { valid: false, error: "OUT_OF_RANGE" };
      return { valid: true, columns: { valueCents: null, valueRatio: value, valueDays: null } };
    case "DAYS":
      if (!Number.isInteger(value)) return { valid: false, error: "NOT_AN_INTEGER" };
      if (value < 1) return { valid: false, error: "OUT_OF_RANGE" };
      return { valid: true, columns: { valueCents: null, valueRatio: null, valueDays: value } };
  }
}

/**
 * Reads the one value column a figure uses.
 *
 * Returns null when the row is malformed — the wrong column set for the kind —
 * rather than falling back to whichever column happens to hold a number. A row
 * edited directly in the database is exactly the case this defends against,
 * and silently reading `valueCents` for a RATIO figure would turn a probability
 * of 0.5 into 50 million percent.
 */
export function figureValueOf(
  figure: EconomicFigure,
  row: { valueCents: number | null; valueRatio: number | null; valueDays: number | null }
): number | null {
  switch (FIGURE_SPECS[figure].kind) {
    case "CENTS":
      return row.valueCents;
    case "RATIO":
      return row.valueRatio;
    case "DAYS":
      return row.valueDays;
  }
}

/**
 * Which evidence reference a basis REQUIRES.
 *
 * THE RULE THAT STOPS A CONFIDENT PROVENANCE STRING STANDING IN FOR EVIDENCE.
 * A `MEASURED` basis has to name the measurement; a `COMPARABLE` basis has to
 * name the opportunity it was derived from. Without this, "measured from the
 * store" as a free-text provenance would be indistinguishable from an actual
 * measurement, and the strongest basis in the system would be the easiest one
 * to claim.
 *
 * `STATED` and `MODEL_SUGGESTED` require nothing, which is correct: a person's
 * own knowledge and a model's proposal are both exactly what they say they are,
 * and neither can commit capital on its own anyway.
 */
export type RequiredEvidence = "MEASUREMENT_OR_EXPERIMENT" | "COMPARABLE_OPPORTUNITY" | "NONE";

export function requiredEvidenceFor(basis: EvidenceBasis): RequiredEvidence {
  switch (basis) {
    case "MEASURED":
      return "MEASUREMENT_OR_EXPERIMENT";
    case "COMPARABLE":
      return "COMPARABLE_OPPORTUNITY";
    case "STATED":
    case "MODEL_SUGGESTED":
      return "NONE";
  }
}

// ---------------------------------------------------------------------------
// THE CAPITAL GATE, over per-figure bases
// ---------------------------------------------------------------------------

/**
 * One figure's basis, as resolved for a particular opportunity.
 *
 * Structurally typed on purpose: the gate below must be callable from the pure
 * expected-value layer without that layer importing anything that touches the
 * database.
 */
export interface FigureBasisReading {
  figure: EconomicFigure;
  /** `"NONE"` when the figure is not known at all. */
  basis: EstimateBasis;
  known: boolean;
}

export type CapitalBlockReason =
  /** Nobody has established the figure, and its absence is not conservative. */
  | "ABSENT"
  /** It is known, on a basis below the capital minimum. */
  | "TOO_WEAK";

export interface CapitalBasisAssessment {
  /** True only when EVERY EV-material figure clears the bar. */
  eligible: boolean;
  /**
   * The figures that block it, NAMED, weakest-first by registry order.
   *
   * The named figure is the whole improvement over the P6-A roll-up. "Its
   * weakest monetary input is a model's proposal" told a person that something
   * needed corroborating without telling them WHICH thing, so the only way to
   * act on it was to re-derive the model by hand.
   */
  blocking: { figure: EconomicFigure; basis: EstimateBasis; reason: CapitalBlockReason }[];
}

/**
 * Decides whether a set of per-figure bases is strong enough to commit capital.
 *
 * ---------------------------------------------------------------------------
 * EVERY MATERIAL FIGURE IS CHECKED ON ITS OWN BASIS
 * ---------------------------------------------------------------------------
 *
 * There is no roll-up, no average and no single governing basis. A measured
 * probability does not make an invented profit fundable, and it is not supposed
 * to: they are separate claims about the world that happen to sit on the same
 * row. The P6-A implementation took the weakest of four figures and reported one
 * label, which gave the right ANSWER in the common case and could not say which
 * figure was responsible — and a refusal nobody can act on gets overridden.
 *
 * ONE ASYMMETRY, deliberate: a figure whose absence is handled by a conservative
 * default (`absenceIsConservative`) does not block by being absent, because its
 * absence cannot flatter the expectation. It still blocks when it is PRESENT on
 * a weak basis, because a present number does move the arithmetic.
 */
export function capitalBasisGate(
  readings: readonly FigureBasisReading[]
): CapitalBasisAssessment {
  const byFigure = new Map(readings.map((r) => [r.figure, r]));
  const blocking: CapitalBasisAssessment["blocking"] = [];

  // Registry order rather than argument order, so the same opportunity always
  // reports the same blocking figure first.
  for (const figure of EV_MATERIAL_FIGURES) {
    const reading = byFigure.get(figure);
    const known = reading?.known === true;
    const basis = reading?.basis ?? "NONE";

    if (!known) {
      if (FIGURE_SPECS[figure].absenceIsConservative) continue;
      blocking.push({ figure, basis: "NONE", reason: "ABSENT" });
      continue;
    }
    if (!canInfluenceCapital(basis)) {
      blocking.push({ figure, basis, reason: "TOO_WEAK" });
    }
  }

  return { eligible: blocking.length === 0, blocking };
}

/** Why a figure blocks capital, in words, for a surface or a deferral detail. */
export function describeCapitalBlock(block: {
  figure: EconomicFigure;
  basis: EstimateBasis;
  reason: CapitalBlockReason;
}): string {
  const label = FIGURE_SPECS[block.figure].label;
  return block.reason === "ABSENT"
    ? `the ${label} has not been established, and an unknown figure is not a zero one`
    : `the ${label} rests on ${describeBasis(block.basis)}`;
}
