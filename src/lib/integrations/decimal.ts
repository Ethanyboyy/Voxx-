/**
 * [P5-F] EXACT DECIMAL → MINOR UNITS. No floats, no assumed scale.
 *
 * A leaf module: pure functions, no database, no network, no imports. It exists
 * because the two ways money normally gets corrupted in a codebase both happen
 * silently and neither throws.
 *
 * ---------------------------------------------------------------------------
 * ONE: PARSING MONEY AS A FLOAT
 * ---------------------------------------------------------------------------
 *
 * `parseFloat("0.10") + parseFloat("0.20")` is `0.30000000000000004`. Summing a
 * few hundred order totals that way produces a number that is wrong in the last
 * places and looks completely ordinary. So nothing here ever converts a money
 * string to a Number: the digits are read as text, concatenated into an integer,
 * and summed as BigInt.
 *
 * AN HONEST NOTE ON HOW MUCH THAT BUYS, TODAY. A double carries ~15 significant
 * digits, and `MAX_AMOUNT_MINOR` caps a total at ~2.1e9 minor units, so at
 * present bounds float accumulation followed by a single round would in fact
 * produce the same answer for every input this module accepts — the accumulated
 * error stays many orders of magnitude below half a minor unit. An attempt to
 * prove otherwise by reverting this to floats failed to break any behavioural
 * test, and that result is recorded here rather than dressed up.
 *
 * The integer path is still the right one, for a reason that does not depend on
 * the current cap: it is correct BY CONSTRUCTION rather than by a magnitude
 * argument. Raise `MAX_AMOUNT_MINOR`, admit a currency with more places, or move
 * this code somewhere the totals are larger, and the float version starts being
 * wrong silently while every test still passes. What enforces this is therefore
 * a source-level test asserting no `parseFloat`/`toFixed`/`Math.round` appears
 * here at all — the behaviour is indistinguishable today, so the *shape* of the
 * code is what is guarded.
 *
 * ---------------------------------------------------------------------------
 * TWO: ASSUMING TWO DECIMAL PLACES
 * ---------------------------------------------------------------------------
 *
 * "Minor units" is not a synonym for "cents". JPY and KRW have no minor unit at
 * all; KWD, BHD and OMR have three. A system that multiplies by 100 reports a
 * ¥5,000 sale as ¥500,000 and a KWD 5.000 sale as KWD 500 — errors of 100× and
 * 10× respectively, in opposite directions, both of which look like plausible
 * money.
 *
 * So the scale is READ, never assumed: it is the number of decimal places the
 * provider actually sent, and it is persisted beside the integer so the amount
 * can be reconstructed exactly as `minor / 10^scale`.
 */

/**
 * The most decimal places a real currency amount can have.
 *
 * Four, not two. Three is the maximum for a circulating currency (KWD, BHD,
 * OMR, JOD, TND), and the fourth is slack for a provider that pads. Beyond that
 * the value is not a currency amount at all — it is an unrounded computed
 * figure, and treating one of those as an exact economic fact is precision
 * laundering.
 */
export const MAX_MONEY_SCALE = 4;

/**
 * The largest total this system will record.
 *
 * `ExperimentMeasurement.observedAmountMinor` is a Prisma `Int`, so a value past
 * 2^31-1 is not representable exactly. Refusing is the honest response — the
 * alternative is a silently truncated or wrapped monetary total, which is the
 * worst possible failure mode for this particular column.
 */
export const MAX_AMOUNT_MINOR = 2_147_483_647;

export interface ParsedDecimal {
  /** The digits, as an exact integer at `scale` decimal places. */
  minor: bigint;
  /** How many decimal places the provider actually used. */
  scale: number;
}

/**
 * Parses a provider's decimal money string exactly, or returns null.
 *
 * DELIBERATELY STRICT. Every rejected shape below is something that could
 * otherwise become a wrong number rather than an error:
 *
 *   "1e3"        an exponent Number() would happily read as 1000
 *   "1,234.00"   a thousands separator that parses as 1 in some locales
 *   " 12.00 "    whitespace, which hides a malformed field
 *   "-5.00"      a negative order total, which is not a thing a store sells
 *   "12."        a trailing point, i.e. a truncated payload
 *   ""           an empty string, which coerces to 0
 *
 * The regex admits digits, one optional point, and digits. Nothing else.
 */
export function parseDecimalToMinor(raw: unknown): ParsedDecimal | null {
  if (typeof raw !== "string") return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;

  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > MAX_MONEY_SCALE) return null;

  // String concatenation, not arithmetic: the digits never become a Number.
  const digits = `${whole}${fraction}`;
  return { minor: BigInt(digits), scale: fraction.length };
}

/** Restates an exact decimal at a larger scale, without losing anything. */
export function rescale(value: ParsedDecimal, scale: number): bigint {
  if (scale < value.scale) {
    throw new Error("rescale cannot reduce scale — that would discard digits.");
  }
  return value.minor * BigInt(10) ** BigInt(scale - value.scale);
}

export type SumFailure = "IMPRECISE_VALUE" | "AMOUNT_OUT_OF_RANGE";

export type SumResult =
  | { summed: true; minor: number; scale: number }
  | { summed: false; failure: SumFailure };

/**
 * Sums exact decimals at a common scale.
 *
 * The common scale is the LARGEST any single value used, so nothing is rounded
 * on the way in: three amounts at 2, 2 and 3 decimal places sum at 3, and the
 * two-place ones are widened rather than the three-place one being trimmed. A
 * sum that rounded its inputs to match would be off by a fraction of a unit per
 * order, in a direction nobody chose.
 *
 * An empty list sums to zero at scale zero, which is correct and is NOT the same
 * thing as a failed observation — the caller establishes the currency separately
 * precisely so that a zero-value window still has one.
 */
export function sumDecimals(values: readonly ParsedDecimal[]): SumResult {
  const scale = values.reduce((max, v) => Math.max(max, v.scale), 0);
  if (scale > MAX_MONEY_SCALE) return { summed: false, failure: "IMPRECISE_VALUE" };

  let total = BigInt(0);
  for (const value of values) total += rescale(value, scale);

  if (total > BigInt(MAX_AMOUNT_MINOR)) return { summed: false, failure: "AMOUNT_OUT_OF_RANGE" };
  return { summed: true, minor: Number(total), scale };
}

/**
 * Renders an exact minor-unit amount for display. Never for arithmetic.
 *
 * Kept here beside the parser so the two can never disagree about what `scale`
 * means, and deliberately currency-code-suffixed rather than symbol-prefixed:
 * "1234.00 JPY" is unambiguous, and "$1234.00" quietly asserts a currency the
 * measurement may not be in.
 */
export function formatMinor(minor: number, scale: number, currency: string): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction} ${currency}`;
}
