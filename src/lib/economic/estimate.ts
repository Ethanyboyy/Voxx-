/**
 * [P6-A] WHERE A NUMBER CAME FROM, AND WHAT IT MAY THEREFORE DECIDE.
 *
 * A leaf module: pure functions, no database, no network, no imports. It exists
 * because P5-D through P5-G spent four phases making MEASUREMENT honest and
 * left FORECASTING untouched, and the forecasting side had the same bug the
 * measurement side was built to prevent.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS MODULE IS ABOUT
 * ---------------------------------------------------------------------------
 *
 * `scoreOpportunity()` in `src/lib/objectives/service.ts` opens with:
 *
 *     const value = o.estimatedValue ?? 1;
 *     const riskPenalty = o.risk ? RISK_PENALTY[o.risk] : 0.15;
 *
 * An opportunity nobody has researched is therefore scored as though it were
 * worth one dollar at moderate risk — and the number that comes out is a plain
 * `number`, indistinguishable from one computed entirely from measured data.
 * Rank a list containing both and the ranking looks equally authoritative all
 * the way down. `valueIsAssumedDefault` in the breakdown shows the author knew;
 * what was missing was any way for the type system to care.
 *
 * This is exactly the `?? 0` hazard from P5-E, moved one layer up: there, a
 * failed observation became a measured zero; here, an absent estimate becomes a
 * ranked opportunity.
 *
 * ---------------------------------------------------------------------------
 * THE FIX: AN UNKNOWN CARRIES NO VALUE FIELD
 * ---------------------------------------------------------------------------
 *
 * `Estimate<T>` is a discriminated union whose unknown arm has NO `value`.
 * Not an optional value, not a nullable one — no property to read. So
 *
 *     const revenue = estimate.value ?? 0;   // does not compile
 *
 * is a type error rather than a code-review note, and every consumer is forced
 * to decide what to do about not knowing. Most of them, correctly, refuse.
 *
 * ---------------------------------------------------------------------------
 * AND A SECOND RULE: A BASIS IS NOT JUST A LABEL
 * ---------------------------------------------------------------------------
 *
 * Knowing a number is not the same as being entitled to act on it. A model can
 * propose that a niche earns $4,000 a month; that proposal is worth recording
 * and worth researching, and it is NOT worth moving money on. So each basis has
 * a RANK, and a decision declares the minimum rank it will accept. Capital
 * allocation sets that minimum above `MODEL_SUGGESTED`, which is what makes
 * "a model's numbers cannot spend money" structural rather than a convention.
 */

/**
 * Where a quantity came from. Ordered weakest to strongest below.
 *
 * The distinctions that matter most are the two at the bottom. `MODEL_SUGGESTED`
 * and `RECORDED` are both "somebody said so", but one of them is a person
 * putting their own knowledge behind a figure and the other is a language model
 * producing a plausible one, and flattening them into "estimate" is how the
 * second quietly acquires the authority of the first.
 */
export type EstimateBasis =
  /** Nobody knows. Carries no value — see `Estimate`. */
  | "NONE"
  /**
   * A model proposed it and nothing corroborates it.
   *
   * Legitimate for research and for ranking what to investigate. NEVER
   * sufficient on its own to allocate capital.
   */
  | "MODEL_SUGGESTED"
  /** Derived from the measured outcome of a comparable opportunity VOX ran. */
  | "COMPARABLE"
  /** A person stated it from their own knowledge of the world. */
  | "RECORDED"
  /**
   * VOX observed it in an external system of record, through the P5-E/F path.
   *
   * The only basis that is a fact about the world rather than a belief about it.
   */
  | "MEASURED";

/**
 * Rank, for comparison. Deliberately NOT exported as a weight — nothing
 * multiplies by these, because a basis is not a confidence score and treating
 * it as one would let a strong basis on one dimension paper over an absent one
 * on another.
 */
const BASIS_RANK: Readonly<Record<EstimateBasis, number>> = Object.freeze({
  NONE: 0,
  MODEL_SUGGESTED: 1,
  COMPARABLE: 2,
  RECORDED: 3,
  MEASURED: 4,
});

export const ESTIMATE_BASES: readonly EstimateBasis[] = Object.freeze([
  "NONE",
  "MODEL_SUGGESTED",
  "COMPARABLE",
  "RECORDED",
  "MEASURED",
] as const);

/** A basis that actually carries a value. `NONE` is excluded by construction. */
export type KnownBasis = Exclude<EstimateBasis, "NONE">;

export interface KnownEstimate<T> {
  known: true;
  value: T;
  basis: KnownBasis;
  /** Where it came from, in words. Required — a number with no source is a rumour. */
  provenance: string;
}

export interface UnknownEstimate {
  known: false;
  basis: "NONE";
  /** Why it is not known, so a surface can say what to go and find out. */
  why: string;
}

/**
 * NOTE WHAT IS ABSENT FROM THE SECOND ARM.
 *
 * There is no `value`, no `cents`, and no `amount` on `UnknownEstimate`. That
 * absence is the entire safeguard: it makes "substitute a default" a thing a
 * caller has to do deliberately and visibly, rather than a thing `??` does for
 * them in passing.
 */
export type Estimate<T> = KnownEstimate<T> | UnknownEstimate;

export function known<T>(value: T, basis: KnownBasis, provenance: string): KnownEstimate<T> {
  return { known: true, value, basis, provenance };
}

export function unknown(why: string): UnknownEstimate {
  return { known: false, basis: "NONE", why };
}

/**
 * Lifts a nullable column into an estimate.
 *
 * The single most-used function here, and the place the old `?? default` habit
 * would otherwise reappear. A null column becomes an `UnknownEstimate` carrying
 * the reason — never a zero, never a one, never a "moderate" default.
 */
export function fromNullable<T>(
  value: T | null | undefined,
  basis: KnownBasis,
  provenance: string,
  why: string
): Estimate<T> {
  return value === null || value === undefined ? unknown(why) : known(value, basis, provenance);
}

/** The weaker of two bases. `NONE` dominates everything, because it should. */
export function weakerBasis(a: EstimateBasis, b: EstimateBasis): EstimateBasis {
  return BASIS_RANK[a] <= BASIS_RANK[b] ? a : b;
}

/**
 * The weakest basis across a set of estimates — the honest basis of anything
 * derived from all of them.
 *
 * A CALCULATION IS ONLY AS GOOD AS ITS WORST INPUT. An expected-profit figure
 * combining a measured conversion rate with a model-suggested price is a
 * model-suggested figure, not a measured one, and averaging the two ranks would
 * have produced exactly the flattering answer this function refuses to give.
 * An empty set is `NONE`: a figure derived from nothing is not well-founded.
 */
export function weakestBasis(estimates: readonly Estimate<unknown>[]): EstimateBasis {
  if (estimates.length === 0) return "NONE";
  return estimates.reduce<EstimateBasis>((worst, e) => weakerBasis(worst, e.basis), "MEASURED");
}

/**
 * Whether a basis is strong enough for a decision of a given consequence.
 *
 * Used by the capital path with a minimum ABOVE `MODEL_SUGGESTED`. That one
 * comparison is what stops a language model's plausible number from becoming an
 * authorized spend, and it is enforced at the point of allocation rather than
 * trusted to whoever wrote the opportunity.
 */
export function meetsMinimumBasis(basis: EstimateBasis, minimum: EstimateBasis): boolean {
  return BASIS_RANK[basis] >= BASIS_RANK[minimum];
}

/**
 * The minimum basis required before an estimate may influence a commitment of
 * real money.
 *
 * `COMPARABLE` — i.e. at least derived from something VOX actually measured, or
 * stated by a person, or measured directly. A model's unsupported proposal is
 * deliberately one rank below this line.
 */
export const CAPITAL_MINIMUM_BASIS: EstimateBasis = "COMPARABLE";

/**
 * Human-readable, for surfaces. Says what the basis IS rather than how
 * confident it sounds, because "low confidence" invites rounding up and
 * "a model proposed this" does not.
 */
export function describeBasis(basis: EstimateBasis): string {
  switch (basis) {
    case "MEASURED":
      return "measured by VOX in an external system of record";
    case "RECORDED":
      return "stated by a person from their own knowledge";
    case "COMPARABLE":
      return "derived from a comparable opportunity VOX measured";
    case "MODEL_SUGGESTED":
      return "proposed by a model, with nothing corroborating it";
    case "NONE":
      return "not known";
  }
}
