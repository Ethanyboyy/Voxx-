/**
 * [P5-G] THE COMMERCIAL ACTION CONTRACT — what will be done, frozen before it
 * is authorized.
 *
 * A leaf module: pure functions, no database, no network, no provider. It is the
 * write-side counterpart to `src/lib/economic/observationContract.ts`, and it
 * exists for the mirror-image reason.
 *
 * An OBSERVATION contract stops the question being chosen after the answer is
 * visible. An ACTION contract stops the parameters being chosen after the
 * approval is given. Both are ordering problems rather than validation problems,
 * because in both cases every individual value is perfectly legitimate — what
 * makes the result illegitimate is when it was decided.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PARAMETERS ARE HASHED AND NOT JUST STORED
 * ---------------------------------------------------------------------------
 *
 * The approval a human gives is bound to `hashArguments(validated tool input)`
 * — see `src/lib/policy/approvals.ts`. If the tool's input were only an action
 * id, the grant would bind that id and NOTHING ELSE, and the parameters could be
 * rewritten between the approval and its use: a person approves 5% off and a
 * 90%-off code is what reaches the store, with a real, matching, single-use
 * grant behind it.
 *
 * So the digest of the parameters travels IN the tool input. The grant binds it,
 * and the execution path re-derives it from the row and refuses on any
 * difference. Editing a parameter after approval therefore breaks two
 * independent checks rather than none.
 *
 * ---------------------------------------------------------------------------
 * WHAT A "BOUNDED" ACTION MEANS HERE
 * ---------------------------------------------------------------------------
 *
 * Every kind in this registry must be bounded in three dimensions, and the
 * validator below enforces all three for the one kind that exists:
 *
 *   IN SIZE      how much it can give away per use  (percentage ceiling)
 *   IN COUNT     how many times it can be used      (usage limit, required)
 *   IN TIME      when it stops                      (end date, required)
 *
 * An unbounded discount is not a smaller version of a bounded one. It is an open
 * liability against a merchant's margin with no ceiling and no expiry, and no
 * approval UI can make a person meaningfully consent to that.
 */

import { createHash } from "node:crypto";
import type { CommercialActionKind } from "@/generated/prisma/enums";

/**
 * The most a single authorized discount may take off.
 *
 * 50%. Not 100 — a 100%-off code is indistinguishable from giving the product
 * away, and if that is genuinely wanted it should be a different action kind
 * that says so in its name rather than a parameter value on this one. The
 * ceiling is here rather than in a UI because a UI is not an enforcement point.
 */
export const MAX_DISCOUNT_FRACTION = 0.5;

/** Below this the action is pointless and is almost certainly a units mistake. */
export const MIN_DISCOUNT_FRACTION = 0.01;

/**
 * The most redemptions one authorized code may ever have.
 *
 * A hard ceiling on top of the required per-action limit, so the worst case of
 * a mis-typed limit is bounded by something nobody can set at call time.
 */
export const MAX_USAGE_LIMIT = 1000;

/** The longest a single authorized code may stay live. */
export const MAX_DISCOUNT_WINDOW_MINUTES = 90 * 24 * 60;

export const MIN_DISCOUNT_WINDOW_MINUTES = 1;

/** Codes customers type. Constrained so the code cannot carry punctuation a store may treat specially. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

/**
 * The parameters of a discount-code action.
 *
 * `percentageFraction` IS A FRACTION, 0.05 meaning 5%.
 *
 * That is Shopify's own unit (`DiscountEffectInput.percentage`, documented as
 * "Value must be between 0.00 - 1.00") and the name says so in full, because
 * the alternative failure is silent and enormous: a "percentage" field holding
 * 5 and meaning 5% becomes 500% off if passed straight through, and holding
 * 0.05 and meaning "5 percent" becomes 0.05% if it is not. The two mistakes are
 * a factor of 10,000 apart and both look like a plausible number in a form.
 */
export interface DiscountCodeParameters {
  /** The code customers type. Uppercase, unique within the store. */
  code: string;
  /** What the merchant sees in their admin. */
  title: string;
  /** A FRACTION between 0 and 1. 0.05 is five percent. */
  percentageFraction: number;
  /** INCLUSIVE start. */
  startsAt: Date;
  /** The end. Required — an unbounded discount is not authorizable. */
  endsAt: Date;
  /** Maximum redemptions. Required, for the same reason. */
  usageLimit: number;
  /** Whether one customer may use it more than once. */
  appliesOncePerCustomer: boolean;
}

export type ContractViolation =
  | "CODE_INVALID"
  | "TITLE_INVALID"
  | "PERCENTAGE_OUT_OF_RANGE"
  | "PERCENTAGE_NOT_A_FRACTION"
  | "WINDOW_INVALID"
  | "WINDOW_TOO_LONG"
  | "USAGE_LIMIT_INVALID"
  | "SCOPE_INVALID";

export type ContractValidation =
  | { valid: true; parameters: DiscountCodeParameters }
  | { valid: false; violations: ContractViolation[] };

/**
 * Validates discount parameters against every bound, returning ALL violations.
 *
 * All of them rather than the first, because a caller fixing one at a time
 * learns the constraints by trial and error, and an audit reading a refusal
 * wants the whole picture.
 */
export function validateDiscountParameters(input: {
  code?: unknown;
  title?: unknown;
  percentageFraction?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimit?: unknown;
  appliesOncePerCustomer?: unknown;
}): ContractValidation {
  const violations: ContractViolation[] = [];

  const code = typeof input.code === "string" ? input.code.toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) violations.push("CODE_INVALID");

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 3 || title.length > 120) violations.push("TITLE_INVALID");

  const fraction = input.percentageFraction;
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    violations.push("PERCENTAGE_OUT_OF_RANGE");
  } else if (fraction > 1) {
    // THE UNITS MISTAKE, caught by name. Someone passed 5 meaning "5 percent".
    // Refused with its own code rather than folded into "out of range", because
    // the fix is different: it is not a smaller number that is needed, it is a
    // different unit.
    violations.push("PERCENTAGE_NOT_A_FRACTION");
  } else if (fraction < MIN_DISCOUNT_FRACTION || fraction > MAX_DISCOUNT_FRACTION) {
    violations.push("PERCENTAGE_OUT_OF_RANGE");
  }

  const startsAt = toDate(input.startsAt);
  const endsAt = toDate(input.endsAt);
  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
    violations.push("WINDOW_INVALID");
  } else {
    const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (minutes < MIN_DISCOUNT_WINDOW_MINUTES || minutes > MAX_DISCOUNT_WINDOW_MINUTES) {
      violations.push("WINDOW_TOO_LONG");
    }
  }

  const usageLimit = input.usageLimit;
  if (
    typeof usageLimit !== "number" ||
    !Number.isInteger(usageLimit) ||
    usageLimit < 1 ||
    usageLimit > MAX_USAGE_LIMIT
  ) {
    violations.push("USAGE_LIMIT_INVALID");
  }

  if (violations.length > 0) return { valid: false, violations };

  return {
    valid: true,
    parameters: {
      code,
      title,
      percentageFraction: fraction as number,
      startsAt: startsAt!,
      endsAt: endsAt!,
      usageLimit: usageLimit as number,
      appliesOncePerCustomer: input.appliesOncePerCustomer === true,
    },
  };
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * The canonical serialization the digest is taken over.
 *
 * Field order is FIXED here rather than taken from `Object.keys`, so the digest
 * cannot change because a field was declared in a different order somewhere.
 * Dates go in as ISO instants so a timezone can never shift one silently.
 */
export function canonicalDiscountParameters(parameters: DiscountCodeParameters): string {
  return JSON.stringify([
    ["code", parameters.code],
    ["title", parameters.title],
    ["percentageFraction", parameters.percentageFraction],
    ["startsAt", parameters.startsAt.toISOString()],
    ["endsAt", parameters.endsAt.toISOString()],
    ["usageLimit", parameters.usageLimit],
    ["appliesOncePerCustomer", parameters.appliesOncePerCustomer],
  ]);
}

/**
 * The freeze.
 *
 * Covers the kind, the store, and every parameter. Carries no secret — it is
 * written to the database, echoed in events, shown in an approval, and put in a
 * tool's arguments, so anything secret inside it would be a secret in the audit
 * log. A shop domain and a discount code are both public by nature.
 */
export function commercialContractDigestOf(input: {
  kind: CommercialActionKind;
  externalScope: string;
  parameters: DiscountCodeParameters;
}): string {
  const canonical = [
    input.kind,
    input.externalScope,
    canonicalDiscountParameters(input.parameters),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Re-reads stored parameters. Returns null rather than guessing at a bad row. */
export function parseStoredParameters(json: string): DiscountCodeParameters | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  // Re-validated, not merely cast. A row edited directly in the database is
  // exactly the case this is defending against, and trusting its shape because
  // it came from our own table is how that edit reaches a provider.
  const validation = validateDiscountParameters(raw as Record<string, unknown>);
  return validation.valid ? validation.parameters : null;
}

/**
 * What this action is, in words, for the human being asked to approve it.
 *
 * Deliberately states the concession in PERCENT while the stored value is a
 * fraction, and names the ceiling on both redemptions and time, because those
 * three numbers are what a person is actually consenting to.
 */
export function describeDiscountAction(parameters: DiscountCodeParameters, scope: string): string {
  const percent = (parameters.percentageFraction * 100).toFixed(2).replace(/\.?0+$/, "");
  return (
    `Create discount code ${parameters.code} on ${scope}: ${percent}% off, ` +
    `usable at most ${parameters.usageLimit} time${parameters.usageLimit === 1 ? "" : "s"}, ` +
    `live from ${parameters.startsAt.toISOString()} until ${parameters.endsAt.toISOString()}. ` +
    `This gives away margin on every redemption. It does not charge anyone, move money, or create revenue.`
  );
}
