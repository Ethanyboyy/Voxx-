/**
 * [P6-A] ONE MODEL EVERY OPPORTUNITY IS COMPARED THROUGH.
 *
 * The problem this solves: VOX is meant to compare a dropshipping test against
 * an affiliate page against a micro-SaaS against a licensing deal. Those have
 * nothing in common as businesses. What they DO have in common is a small set
 * of economic dimensions — what it costs, what it might return, how likely that
 * is, how long until you find out, and how much you can lose — and comparing
 * them on anything else is comparing their marketing.
 *
 * So this module reads the EXISTING `Opportunity` row (which already carries
 * every field needed, from P4-F onward) and projects it onto those dimensions,
 * attaching a BASIS to each one. Nothing is stored; nothing is invented; the
 * category stays free text so the taxonomy is open — an opportunity kind nobody
 * anticipated normalizes exactly like one that was.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not score. It does not rank. It does not fill a gap with a default.
 * A dimension nobody has established comes back `known: false` carrying the
 * reason, and `expectedValue.ts` is where the consequences of not knowing are
 * decided. Keeping those apart is what makes the refusal auditable: you can
 * look at a model and see exactly which facts are missing, without a score
 * standing in front of them.
 *
 * THE PROBABILITY DIMENSION IS THE INTERESTING ONE. It prefers VOX's OWN
 * measured track record for this opportunity — `getMeasuredProbability()` from
 * P5-C, over reconciled experiment verdicts — and falls back to the human's
 * recorded column only when there is no measured basis. That is the one place
 * in this system where a forecast input can legitimately be `MEASURED`, and it
 * exists because P5-D through P5-F built the loop that produces it.
 */

import { db } from "@/lib/db";
import { getMeasuredProbability } from "@/lib/economic/probability";
import {
  fromNullable,
  known,
  unknown,
  weakestBasis,
  type Estimate,
  type EstimateBasis,
} from "@/lib/economic/estimate";
import type { Opportunity, RiskLevel } from "@/generated/prisma/client";

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
   * The weakest basis across the MONETARY dimensions.
   *
   * The honest label for anything derived from them, and the value the capital
   * path checks against `CAPITAL_MINIMUM_BASIS`.
   */
  monetaryBasis: EstimateBasis;
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
 * [P6-A] AN HONEST LIMITATION, AND A HEURISTIC OVER THE EXISTING SCHEMA.
 *
 * `Opportunity` has no per-figure provenance column — it has ONE `source`
 * column describing how the opportunity was discovered. So a figure stated on a
 * row VOX's own research surfaced is indistinguishable, at the column level,
 * from one the user typed. Treating both as `RECORDED` would make
 * `MODEL_SUGGESTED` unreachable and the capital-basis guard theoretical: a
 * figure a model invented would spend money exactly as readily as one a person
 * stood behind.
 *
 * So the discovery source is used as a proxy, in the conservative direction
 * only: a row discovered by a human reads as `RECORDED`, and a row discovered
 * by anything else reads as `MODEL_SUGGESTED` until it is corroborated. That
 * can understate a figure a person later confirmed, and understating is the
 * safe error — it asks for corroboration rather than releasing capital.
 *
 * A per-figure provenance column is the real fix and belongs in a later phase.
 * This is named as a heuristic rather than presented as provenance.
 */
const HUMAN_SOURCES: readonly string[] = Object.freeze(["user", "human", "owner", "manual"]);

/**
 * The basis any figure stated on this row may claim.
 *
 * Never stronger than `RECORDED`: a value typed into a column is not a
 * measurement, whoever typed it.
 */
export function statedBasisFor(source: string | null): "RECORDED" | "MODEL_SUGGESTED" {
  if (source === null || source.trim().length === 0) {
    // No source recorded at all. Treated as human, because the pre-P4-F rows
    // and everything a person creates through the UI legitimately have none,
    // and assuming a model wrote them would block capital on every older row.
    return "RECORDED";
  }
  return HUMAN_SOURCES.includes(source.trim().toLowerCase()) ? "RECORDED" : "MODEL_SUGGESTED";
}

function magnitudeOf(
  value: RiskLevel | null,
  basis: "RECORDED" | "MODEL_SUGGESTED",
  provenance: string,
  why: string
): Estimate<Magnitude> {
  return fromNullable(value, basis, provenance, why);
}

/**
 * Projects one opportunity onto the common dimensions.
 *
 * `measuredProbability` is passed in rather than fetched, so this function
 * stays synchronous and pure — which is what lets the whole dimension table be
 * tested by enumeration instead of by staging database fixtures.
 */
export function projectOpportunity(
  opportunity: Opportunity,
  measuredProbability: { probability: number | null; decided: number } | null
): OpportunityModelView {
  // What a figure merely STATED on this row is entitled to claim. A measured
  // probability below overrides it; nothing else can raise it.
  const stated = statedBasisFor(opportunity.source);

  // ---- PROBABILITY: VOX's own measured record first ----------------------
  //
  // `getMeasuredProbability()` returns null with no decided trials, and null
  // must stay null: a success rate over zero trials does not exist, and
  // substituting 0.5 here would be the `?? default` bug wearing a bell curve.
  const probabilityOfSuccess: Estimate<number> =
    measuredProbability && measuredProbability.probability !== null && measuredProbability.decided > 0
      ? known(
          measuredProbability.probability,
          "MEASURED",
          `${measuredProbability.decided} reconciled experiment verdict${measuredProbability.decided === 1 ? "" : "s"} on this opportunity`
        )
      : fromNullable(
          opportunity.probabilityOfSuccess,
          stated,
          "stated on the opportunity",
          "no experiment has been reconciled for this opportunity and nobody has stated a probability"
        );

  const marginFraction = fromNullable(
    opportunity.estimatedMargin,
    stated,
    "estimatedMargin on the opportunity",
    "no margin has been established"
  );

  const expectedRevenueCents = fromNullable(
    opportunity.expectedRevenueCents,
    stated,
    "expectedRevenueCents on the opportunity",
    "no expected revenue has been established"
  );

  // ---- PROFIT: stated, or derived from revenue AND margin ----------------
  //
  // Derived only when BOTH inputs are known, and the derived figure inherits
  // the weaker of their two bases. Deriving from revenue alone would mean
  // assuming a margin, and an assumed margin on a dropshipping opportunity is
  // the difference between a business and a hobby.
  const statedProfit = fromNullable(
    opportunity.expectedProfitCents,
    stated,
    "expectedProfitCents on the opportunity",
    "no expected profit has been established"
  );
  const expectedProfitCents: Estimate<number> = statedProfit.known
    ? statedProfit
    : expectedRevenueCents.known && marginFraction.known
      ? known(
          Math.round(expectedRevenueCents.value * marginFraction.value),
          // The weaker of the two it was derived from — never the stronger.
          weakestBasis([expectedRevenueCents, marginFraction]) as Exclude<EstimateBasis, "NONE">,
          `derived from expected revenue × margin (${describeInputs(expectedRevenueCents, marginFraction)})`
        )
      : unknown(
          "expected profit was not stated, and it cannot be derived without both an expected revenue and a margin"
        );

  const dimensions: OpportunityDimensions = {
    expectedRevenueCents,
    expectedProfitCents,
    requiredCapitalCents: fromNullable(
      opportunity.requiredCapitalCents,
      stated,
      "requiredCapitalCents on the opportunity",
      "no capital requirement has been established"
    ),
    marginFraction,
    probabilityOfSuccess,
    maxLossCents: fromNullable(
      opportunity.maxLossCents,
      stated,
      "maxLossCents on the opportunity",
      "no worst-case loss has been established"
    ),
    timeToPayoutDays: fromNullable(
      opportunity.timeToPayoutDays ?? opportunity.estimatedTimeToRevenueDays,
      stated,
      "timeToPayoutDays on the opportunity",
      "no time-to-result has been established"
    ),
    scalability: magnitudeOf(opportunity.scalability, stated, "scalability on the opportunity", "scalability is unassessed"),
    competition: magnitudeOf(opportunity.competition, stated, "competition on the opportunity", "competition is unassessed"),
    complexity: magnitudeOf(opportunity.complexity, stated, "complexity on the opportunity", "complexity is unassessed"),
    humanInvolvement: magnitudeOf(
      opportunity.requiredHumanInvolvement,
      stated,
      "requiredHumanInvolvement on the opportunity",
      "required human involvement is unassessed"
    ),
  };

  // The monetary basis governs what may spend money, so it is computed across
  // the money dimensions only — an assessed `scalability` must not be able to
  // lift the basis of a figure it had no part in.
  const monetaryBasis = weakestBasis([
    dimensions.expectedProfitCents,
    dimensions.requiredCapitalCents,
    dimensions.probabilityOfSuccess,
    dimensions.maxLossCents,
  ]);

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
    monetaryBasis,
    missing,
  };
}

function describeInputs(...estimates: Estimate<unknown>[]): string {
  return estimates
    .map((e) => (e.known ? e.basis.toLowerCase().replace("_", " ") : "unknown"))
    .join(" + ");
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

  const measured = await getMeasuredProbability({ userId, opportunityId });
  return projectOpportunity(opportunity, measured);
}

/**
 * Every opportunity worth comparing, projected.
 *
 * Measured probabilities are fetched per opportunity because
 * `getMeasuredProbability()` is scoped that way; the opportunities themselves
 * come back in one query rather than N.
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

  return Promise.all(
    opportunities.map(async (opportunity) =>
      projectOpportunity(opportunity, await getMeasuredProbability({ userId, opportunityId: opportunity.id }))
    )
  );
}
