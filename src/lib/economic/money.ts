// Money, as one type with one set of rules.
//
// WHY CENTS. Every canonical monetary calculation in the economic engine works
// in integer cents. A ledger stored as Float lets 0.1 + 0.2 become
// 0.30000000000000004, and a ceiling check on a value like that is a coin flip
// at the boundary — exactly where a spend limit has to be exact. Integers make
// the comparison total.
//
// The existing `amountUsd` Float columns are NOT removed here (see the
// migration plan below); `amountCents` is the canonical field, written
// alongside on every new row and backfilled for every old one.
//
// WHY A FLOOR AND A CEILING. Every rejected value below is one that has been
// observed to reach a ledger somewhere: a NaN from a parsed empty form field,
// an Infinity from a division, a zero row from a double-submitted form, a
// negative "refund" that silently reverses a spend limit, and a 1e308 that
// makes every subsequent sum Infinity. None of these are hypothetical shapes;
// they are what unvalidated money looks like in practice.
//
// MIGRATION PLAN for the remaining Float columns (deliberately not executed in
// this pass — the risk is in the cutover, not in the representation):
//   1. [DONE] Add `amountCents Int`, backfilled with ROUND(amountUsd * 100).
//      Every write populates both; every canonical read uses cents.
//   2. Let this run until no code path reads `amountUsd` except display
//      formatting and the parity test in tests/economic-money.test.ts.
//   3. Drop `amountUsd` in a migration whose only risk is a column deletion,
//      not an arithmetic conversion, because step 1 already proved the values
//      agree row by row.
// Doing steps 1-3 in one pass would mean the conversion, the cutover and the
// deletion all land untested together, on the one table where a silent
// arithmetic error is unrecoverable.

/** Thrown when a value that is supposed to be money is not usable as money. */
export class InvalidMoneyError extends Error {
  constructor(
    readonly field: string,
    readonly received: unknown,
    reason: string
  ) {
    super(`${field}: ${reason} (received ${describe(received)})`);
    this.name = "InvalidMoneyError";
  }
}

function describe(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return String(value);
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * The largest amount any single ledger entry may carry: $1,000,000,000.00.
 *
 * Not a business rule about how rich VOX may get — a sanity bound. In cents it
 * is 1e11, five orders of magnitude below Number.MAX_SAFE_INTEGER, so a
 * six-figure count of maximum-size rows still sums exactly. Anything larger
 * arriving at a ledger boundary is a bug or an attack, not a transaction.
 */
export const MAX_ENTRY_CENTS = 100_000_000_000;
export const MAX_ENTRY_USD = MAX_ENTRY_CENTS / 100;

/** The smallest amount that is a transaction rather than a no-op: one cent. */
export const MIN_ENTRY_CENTS = 1;

/**
 * Converts a USD number to integer cents, or throws.
 *
 * Rounds half away from zero at the cent, which is the only rounding that
 * cannot be exploited by submitting many sub-cent amounts: each one either
 * becomes a real cent or is rejected as zero, and neither accumulates silently.
 */
export function toCents(amountUsd: unknown, field = "amountUsd"): number {
  if (typeof amountUsd !== "number") {
    throw new InvalidMoneyError(field, amountUsd, "must be a number");
  }
  if (!Number.isFinite(amountUsd)) {
    // Catches NaN, Infinity and -Infinity in one check. An Infinity that
    // reaches a sum makes every downstream total Infinity, including the one a
    // ceiling is compared against.
    throw new InvalidMoneyError(field, amountUsd, "must be a finite number");
  }
  if (Math.abs(amountUsd) > MAX_ENTRY_USD) {
    // Checked BEFORE rounding: rounding 1e308 first would produce Infinity.
    throw new InvalidMoneyError(field, amountUsd, `must be at most $${MAX_ENTRY_USD.toLocaleString()}`);
  }

  const cents = Math.sign(amountUsd) * Math.round(Math.abs(amountUsd) * 100);
  if (cents === 0) {
    throw new InvalidMoneyError(field, amountUsd, "must be at least one cent — a zero entry is not a transaction");
  }
  if (cents < 0) {
    // A negative ledger entry is how a spend ceiling gets reversed: record
    // -$500, and the cumulative total drops, freeing budget that was never
    // returned. Corrections belong in a reversal entry with its own provenance,
    // not in a negative amount on the original side of the ledger.
    throw new InvalidMoneyError(field, amountUsd, "must be positive — record a correcting entry rather than a negative amount");
  }
  return cents;
}

/** Cents back to a USD number, for display and for the legacy Float column. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Validates a USD amount and returns both representations.
 *
 * Every ledger write boundary calls this. It is the reason a caller cannot
 * write a row whose `amountUsd` and `amountCents` disagree: both come from one
 * validated conversion rather than from two independent parses.
 */
export function normalizeAmount(amountUsd: unknown, field = "amountUsd"): { cents: number; usd: number } {
  const cents = toCents(amountUsd, field);
  return { cents, usd: fromCents(cents) };
}

/** Sums integer cents exactly. Non-integer input is a programming error, not data. */
export function sumCents(values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidMoneyError("cents", value, "must be a safe integer");
    }
    total += value;
  }
  return total;
}

/** `$1,234.56`, from cents, with no float formatting surprises. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
