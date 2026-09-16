/**
 * [P5-G] THE EXTERNAL COMMERCIAL WRITE PORT.
 *
 * A SEPARATE FILE FROM `economic.ts`, deliberately, and this is the first
 * decision to defend.
 *
 * `economic.ts` is the READ port, and its doc comment makes a promise: every
 * method on it is a read, and a test asserts that by name. Adding a write method
 * there would have quietly converted "the port through which VOX observes" into
 * "the port through which VOX acts", and every reader who had internalised the
 * first statement would have carried on believing it. Two ports means the
 * distinction survives being forgotten: a file that can only read, and a file
 * whose name says it cannot.
 *
 * ---------------------------------------------------------------------------
 * THE THREE OUTCOMES, AND WHY THERE ARE THREE
 * ---------------------------------------------------------------------------
 *
 * A read has two honest outcomes: a value, or no value. A WRITE has three, and
 * the third is the one systems get wrong:
 *
 *   APPLIED    the provider confirmed it, and what it confirmed matches what
 *              was asked for
 *   REFUSED    the provider explicitly declined. Nothing was created.
 *   UNKNOWN    it was submitted and what happened cannot be established
 *
 * UNKNOWN is not a failure. A timeout means the request may well have been
 * processed — the answer simply did not come back. Treating it as a failure
 * invites a retry, and a retry of a write that already succeeded creates a
 * second real thing in a merchant's store. Treating it as a success invents an
 * external state that may not exist.
 *
 * So `WriteOutcome` has three arms, the UNKNOWN arm carries NO external id (you
 * cannot name a thing you do not know exists), and the REFUSED arm carries no
 * external id either. Only `applied` has one, and the type checker is what
 * enforces that — there is no field to read on the other two.
 */

import { createHash } from "node:crypto";
import type { DiscountCodeParameters } from "@/lib/commerce/contract";

/** Why a write was refused, or why its outcome cannot be established. */
export type WriteFailure =
  /** No connection, or it is not CONNECTED. Nothing was sent. */
  | "NOT_CONFIGURED"
  /** The write permission is not granted. Nothing was sent. */
  | "NOT_AUTHORIZED"
  /** The stored credential is missing, unreadable, or lacks the write scope. */
  | "CREDENTIAL_INVALID"
  /** The stored store address is not a shape this provider will talk to. */
  | "SCOPE_INVALID"
  /** The provider rejected the credential. */
  | "PROVIDER_REJECTED"
  /** The provider is throttling. */
  | "PROVIDER_THROTTLED"
  /** The provider explicitly declined the request itself (validation, duplicate). */
  | "PROVIDER_DECLINED"
  /** The provider could not be reached, or did not answer in time. */
  | "PROVIDER_UNAVAILABLE"
  /** The provider answered with something this code cannot read. */
  | "RESPONSE_UNREADABLE"
  /**
   * The provider created something, and it is NOT what was asked for.
   *
   * Never a success, and never a plain failure either: external state now exists
   * that nobody authorized in that shape, and a person has to look at it.
   */
  | "ECHO_MISMATCH"
  /** A code with this name already exists in the store. */
  | "ALREADY_EXISTS";

export interface WriteApplied {
  outcome: "APPLIED";
  /** The provider's id for the thing that now exists. */
  externalId: string;
  provider: string;
  scope: string;
  appliedAt: Date;
  /** sha256 of the raw response. Never the response. */
  responseDigest: string;
}

export interface WriteRefused {
  outcome: "REFUSED";
  failure: WriteFailure;
  /** Safe to show. Never carries a token or a raw response body. */
  detail: string;
  provider: string;
  attemptedAt: Date;
}

export interface WriteUnknown {
  outcome: "UNKNOWN";
  failure: WriteFailure;
  detail: string;
  provider: string;
  attemptedAt: Date;
}

/**
 * NOTE WHAT IS ABSENT FROM TWO OF THESE THREE.
 *
 * `externalId` exists only on `WriteApplied`. There is no optional id on the
 * other arms, so no caller can write `outcome.externalId ?? null` and persist a
 * reference to something that may not exist — the property is not there to read.
 */
export type WriteOutcome = WriteApplied | WriteRefused | WriteUnknown;

/** What the store says about a thing VOX may have created. */
export type VerificationOutcome =
  | {
      verified: true;
      /** Whether the store holds a thing with this identity at all. */
      exists: boolean;
      /** True only when every declared parameter matches the store's copy. */
      matches: boolean;
      /** The store's id, when it exists. */
      externalId: string | null;
      /** How many times it has been redeemed. A COUNT, never money. */
      redemptions: number | null;
      detail: string;
      provider: string;
      checkedAt: Date;
      responseDigest: string;
    }
  | {
      verified: false;
      failure: WriteFailure;
      detail: string;
      provider: string;
      checkedAt: Date;
    };

export interface DiscountWriteRequest {
  scope: string;
  /** The decrypted access token. Never persisted by the caller. */
  accessToken: string;
  parameters: DiscountCodeParameters;
}

export interface DiscountVerifyRequest {
  scope: string;
  accessToken: string;
  /** The code to look for, and the parameters its store copy must match. */
  parameters: DiscountCodeParameters;
}

/**
 * The write port. ONE creating method, and ONE method to ask what happened.
 *
 * The pairing is the point, and it is the reason `verifyDiscountCode` lives on
 * the WRITE port rather than the read one: an UNKNOWN write can only ever be
 * resolved by asking, so the ability to ask is part of the ability to act
 * safely. A port that could create but not check would have no honest way out
 * of its own ambiguity, and the only remaining move would be a retry.
 *
 * There is deliberately no update, no delete, no publish, no price change, and
 * no order, refund or payment method. Each of those is a new method in a diff
 * someone reads, against this comment.
 */
export interface CommercialWriteProvider {
  readonly provider: string;
  createDiscountCode(request: DiscountWriteRequest): Promise<WriteOutcome>;
  verifyDiscountCode(request: DiscountVerifyRequest): Promise<VerificationOutcome>;
}

const WRITE_PROVIDERS = new Map<string, CommercialWriteProvider>();

export function registerCommercialWriteProvider(provider: CommercialWriteProvider): void {
  WRITE_PROVIDERS.set(provider.provider, provider);
}

export function getCommercialWriteProvider(id: string): CommercialWriteProvider | null {
  return WRITE_PROVIDERS.get(id) ?? null;
}

export function listCommercialWriteProviders(): string[] {
  return [...WRITE_PROVIDERS.keys()].sort();
}

export function writeResponseDigestOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
