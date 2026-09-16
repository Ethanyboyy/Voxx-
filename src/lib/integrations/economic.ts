/**
 * [P5-E] THE EXTERNAL ECONOMIC OBSERVATION PORT.
 *
 * VOX's abstraction for asking an outside system of record what happened. Per
 * CLAUDE.md rule 2, no vendor client is ever called outside `src/lib/integrations/`
 * — this file defines the shape, `shopify.ts` implements it, and everything
 * upstream talks only to the interface below.
 *
 * ---------------------------------------------------------------------------
 * THE ONE DESIGN DECISION THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 * `ObservationOutcome` is a discriminated union whose FAILURE ARM HAS NO `value`
 * FIELD. Not an optional value, not a nullable one — no field at all.
 *
 * That is not stylistic. The natural way to write this module is a result object
 * with `value: number | null` and an error string, and every consumer of that
 * shape eventually writes `result.value ?? 0`. The `?? 0` looks defensive. What
 * it actually does is convert "the store did not answer" into "the store said
 * zero", and those are opposite claims: one is an absence of knowledge, the
 * other is a measured economic fact. With the failure arm carrying no value, the
 * type checker refuses to compile the `?? 0`. There is no code path from a
 * failure to a number.
 *
 * THREE STATES, NEVER COLLAPSED:
 *
 *   OBSERVED ZERO    the store was asked and said zero. A real measurement.
 *   UNAVAILABLE      the store could not be asked, or would not answer.
 *   NOT CONFIGURED   there is no store. Nothing was asked of anyone.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY METHOD ON THE PORT IS A READ
 * ---------------------------------------------------------------------------
 *
 * An integration surface grows by accident. Two read methods — how many orders,
 * and how much they came to — can between them cancel nothing, refund nothing
 * and move no money, and adding the ability to do any of those means adding a
 * method to this interface, in a diff someone reads, against a doc comment that
 * says the port is read-only.
 *
 * [P5-F] The second method is the reason this heading changed from "exactly one
 * method". The invariant was never the COUNT of methods; it was that none of
 * them writes. `tests/p5-e-external-observation.test.ts` asserts that directly.
 */

import { db } from "@/lib/db";
import { decryptField } from "@/lib/security/crypto";
import { createHash } from "node:crypto";
import type { MeasurementSemantics } from "@/generated/prisma/client";
import type { ConnectionService } from "@/generated/prisma/enums";

/**
 * Why no number came back.
 *
 * Each of these is a genuinely different situation and a surface should be able
 * to say which. Collapsing them into "error" is how a merchant whose token
 * expired gets told their store made nothing.
 */
export type ObservationFailure =
  /** No connection for this service, or it is not CONNECTED. Nobody was asked. */
  | "NOT_CONFIGURED"
  /** Connected, but the read permission is not granted. */
  | "NOT_AUTHORIZED"
  /** The stored credential is missing, unreadable, or lacks the required scope. */
  | "CREDENTIAL_INVALID"
  /** The provider rejected the credential. Usually an expired or revoked token. */
  | "PROVIDER_REJECTED"
  /** The provider is throttling. Distinct from an error: retrying later works. */
  | "PROVIDER_THROTTLED"
  /** The provider failed, timed out, or returned something unreadable. */
  | "PROVIDER_UNAVAILABLE"
  /** The provider answered, but not with an exact figure. See CountPrecision. */
  | "IMPRECISE_RESULT"
  /** The experiment declares no complete observation contract. */
  | "NO_CONTRACT"
  /** The contract changed after dispatch. The answer would address a different question. */
  | "CONTRACT_ALTERED"
  /** The declared window has not closed. Counting now would count a partial period. */
  | "WINDOW_NOT_CLOSED"
  /** The window closed too long ago for the store's answer to still describe it. */
  | "WINDOW_EXPIRED"
  /** The stored scope is not a shape this provider will talk to. */
  | "SCOPE_INVALID"
  // --- [P5-F] Money-specific refusals. Each one is a case where a number could
  // --- be produced but would not be trustworthy, so none is produced at all.
  /** More than one currency appeared. A sum across currencies is not an amount. */
  | "CURRENCY_AMBIGUOUS"
  /** An amount was not an exact decimal at a plausible currency scale. */
  | "IMPRECISE_VALUE"
  /** Fewer orders were read than the store itself counts for the same window. */
  | "INCOMPLETE_RESULT"
  /** The store's own count moved while the pages were being read. */
  | "RESULT_UNSTABLE"
  /** The window holds more orders than can be paged within a sane bound. */
  | "RESULT_SET_TOO_LARGE"
  /** The total exceeds what the measurement column can hold exactly. */
  | "AMOUNT_OUT_OF_RANGE";

export interface ObservationSuccess {
  observed: true;
  /** The integer the provider returned. Never computed, never adjusted. */
  value: number;
  /** What was counted, in words. */
  unit: string;
  /** The provider id, e.g. "shopify". */
  provider: string;
  /** WHICH external thing answered, e.g. the shop domain. Never a secret. */
  scope: string;
  retrievedAt: Date;
  /** Hash of the raw response body. Never the body, which may carry anything. */
  responseDigest: string;
  /** INCLUSIVE. */
  windowStart: Date;
  /** EXCLUSIVE. */
  windowEnd: Date;
  semantics: MeasurementSemantics;
}

export interface ObservationRefusal {
  observed: false;
  failure: ObservationFailure;
  /** Human-readable, safe to show. Never carries a token or a raw response. */
  detail: string;
  provider: string;
  attemptedAt: Date;
}

export type ObservationOutcome = ObservationSuccess | ObservationRefusal;

/**
 * [P5-F] A MONETARY observation.
 *
 * Note what is NOT here: a `valueUsd`, a `formattedTotal`, or any single field
 * that could be read as an amount on its own. `amountMinor`, `amountScale` and
 * `currency` are three parts of one fact and are always carried together —
 * because an integer without its scale and its currency is not money, it is a
 * number that will eventually be rendered with someone's assumed symbol.
 *
 * `orderCount` rides along deliberately. It is the COMPLETENESS PROOF: the sum
 * is only accepted when the number of orders read equals the store's own count
 * for the same window, so recording that number beside the amount lets anyone
 * re-check the claim later.
 */
export interface ValueObservationSuccess {
  observed: true;
  /** The exact total in minor units at `amountScale`. */
  amountMinor: number;
  /** Decimal places, read from the provider. Never assumed to be 2. */
  amountScale: number;
  /** The single currency that held across the shop and every order summed. */
  currency: string;
  /** How many orders went into the sum. Equal to the store's own count. */
  orderCount: number;
  unit: string;
  provider: string;
  scope: string;
  retrievedAt: Date;
  responseDigest: string;
  /** INCLUSIVE. */
  windowStart: Date;
  /** EXCLUSIVE. */
  windowEnd: Date;
  semantics: MeasurementSemantics;
}

/**
 * Same discipline as `ObservationOutcome`: the failure arm has no amount field,
 * so "the store did not answer" cannot become "the store recorded 0.00".
 */
export type ValueObservationOutcome = ValueObservationSuccess | ObservationRefusal;

export interface OrderCountQuery {
  /** The shop domain or equivalent identifier. */
  scope: string;
  /** The decrypted access token. Never persisted anywhere by the caller. */
  accessToken: string;
  /** INCLUSIVE. */
  windowStart: Date;
  /** EXCLUSIVE. */
  windowEnd: Date;
}

/**
 * The port. Two methods, both reads, neither able to change anything.
 */
export interface EconomicObservationProvider {
  readonly provider: string;
  readonly unit: string;
  /** [P5-F] What the monetary figure means, in words. */
  readonly valueUnit: string;
  countOrdersInWindow(query: OrderCountQuery): Promise<ObservationOutcome>;
  /**
   * [P5-F] The total monetary value of the orders in the same declared window.
   *
   * A SECOND READ METHOD, AND STILL NO WRITE. The port's rule is unchanged:
   * adding the ability to change anything in the merchant's store means adding a
   * method here, in a diff someone reads. Reading how much is not a greater
   * authority than reading how many — it is the same authenticated read of the
   * same resource, returning a different column.
   */
  sumOrderValueInWindow(query: OrderCountQuery): Promise<ValueObservationOutcome>;
}

const PROVIDERS = new Map<string, EconomicObservationProvider>();

export function registerEconomicProvider(provider: EconomicObservationProvider): void {
  PROVIDERS.set(provider.provider, provider);
}

export function getEconomicProvider(id: string): EconomicObservationProvider | null {
  return PROVIDERS.get(id) ?? null;
}

export function listEconomicProviders(): string[] {
  return [...PROVIDERS.keys()].sort();
}

/**
 * A hash of the provider's raw response.
 *
 * The RESPONSE ITSELF IS NEVER STORED. A store's order payload contains customer
 * names, addresses and email addresses, and persisting it to make an audit
 * trail nicer would put third-party personal data in VOX's database for no
 * measurement benefit. The digest proves the answer has not been edited since,
 * which is the only property the audit trail actually needs.
 */
export function responseDigestOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ResolvedCredential {
  scope: string;
  accessToken: string;
  /** The OAuth scope string the credential was issued with. */
  grantedScope: string;
}

export type CredentialResolution =
  | { resolved: true; credential: ResolvedCredential }
  | { resolved: false; failure: ObservationFailure; detail: string };

/**
 * THE TENANT BOUNDARY.
 *
 * Every lookup here is scoped by `userId`. A provider is handed a token and a
 * scope and has no idea whose they are, so this function is the only thing
 * standing between one user's experiment and another user's store — which is
 * why the `userId` is in the WHERE clause rather than checked afterwards.
 *
 * It also enforces, in order: the connection exists, it is CONNECTED (not
 * PAUSED, REVOKED or ERROR), read access is actually granted, and a credential
 * row exists and decrypts. Each failure is reported distinctly, because
 * "reconnect your store" and "grant read access" are different instructions.
 */
export async function resolveConnectionCredential(
  userId: string,
  service: ConnectionService
): Promise<CredentialResolution> {
  const connection = await db.connection.findFirst({
    where: { userId, service },
    include: { credential: true },
  });

  if (!connection) {
    return { resolved: false, failure: "NOT_CONFIGURED", detail: `No ${service} store is connected.` };
  }
  if (connection.status !== "CONNECTED") {
    return {
      resolved: false,
      failure: "NOT_CONFIGURED",
      detail: `The ${service} connection is ${connection.status.toLowerCase()}, not connected.`,
    };
  }
  if (!connection.readEnabled) {
    return {
      resolved: false,
      failure: "NOT_AUTHORIZED",
      detail: `Read access to ${service} is not granted.`,
    };
  }
  if (!connection.credential) {
    return {
      resolved: false,
      failure: "CREDENTIAL_INVALID",
      detail: `The ${service} connection has no stored credential.`,
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decryptField(connection.credential.encryptedPayload)) as Record<string, unknown>;
  } catch {
    // Deliberately says nothing about WHY it would not decrypt. A detailed
    // message here would be a description of the encryption state of a secret.
    return {
      resolved: false,
      failure: "CREDENTIAL_INVALID",
      detail: `The stored ${service} credential could not be read.`,
    };
  }

  const accessToken = payload.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return {
      resolved: false,
      failure: "CREDENTIAL_INVALID",
      detail: `The stored ${service} credential has no access token.`,
    };
  }

  // The scope is read from the connection's NON-SECRET config, not from the
  // encrypted payload, so that a surface can show which store is connected
  // without ever touching the credential.
  let scope = "";
  if (connection.config) {
    try {
      const config = JSON.parse(connection.config) as Record<string, unknown>;
      if (typeof config.scope === "string") scope = config.scope;
    } catch {
      scope = "";
    }
  }
  if (!scope) {
    return {
      resolved: false,
      failure: "CREDENTIAL_INVALID",
      detail: `The ${service} connection does not record which store it points at.`,
    };
  }

  const grantedScope = typeof payload.grantedScope === "string" ? payload.grantedScope : "";
  return { resolved: true, credential: { scope, accessToken, grantedScope } };
}
