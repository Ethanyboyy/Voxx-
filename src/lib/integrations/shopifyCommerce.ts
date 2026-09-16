/**
 * [P5-G] SHOPIFY — the commercial WRITE provider.
 *
 * One mutation: create a bounded discount code. One query: ask whether it
 * exists. Nothing else. There is no update, no delete, no publish, no price
 * change, no order, no refund, and no payment method in this file.
 *
 * Verified against the live Admin GraphQL schema before being written, per
 * CLAUDE.md rule 1 — `discountCodeBasicCreate(basicCodeDiscount:)` returns
 * `{ codeDiscountNode, userErrors { field message code } }`, and
 * `DiscountEffectInput.percentage` is documented as "Value must be between
 * 0.00 - 1.00". Neither is assumed.
 *
 * ---------------------------------------------------------------------------
 * THE TWO HAZARDS THIS FILE IS ABOUT
 * ---------------------------------------------------------------------------
 *
 * ONE: "NO ERROR" IS NOT "SUCCESS". Shopify's mutations return `userErrors`
 * alongside the created object, and a GraphQL request can carry an `errors[]`
 * body under HTTP 200. The natural implementation —
 *
 *     const json = await response.json();
 *     return { created: true, id: json.data.discountCodeBasicCreate.codeDiscountNode.id };
 *
 * — reports a validation failure as a creation, because it never looked at
 * `userErrors` and never checked that a node came back at all. Success here
 * requires FOUR things to hold at once: no transport failure, no top-level
 * errors, an empty `userErrors`, and a node carrying an id.
 *
 * TWO: A CONFIRMATION IS NOT A MATCH. Even a clean success only tells you the
 * provider created something. It does not tell you it created what you asked
 * for. So the echoed code, percentage, usage limit and window are compared
 * against the request, and a mismatch is `ECHO_MISMATCH` — which is neither a
 * success nor a failure, because external state now exists in a shape nobody
 * authorized.
 */

import {
  registerCommercialWriteProvider,
  writeResponseDigestOf,
  type CommercialWriteProvider,
  type DiscountVerifyRequest,
  type DiscountWriteRequest,
  type VerificationOutcome,
  type WriteFailure,
  type WriteOutcome,
  type WriteRefused,
  type WriteUnknown,
} from "@/lib/integrations/commerce";
import { isValidShopDomain, SHOPIFY_API_VERSION } from "@/lib/integrations/shopify";
import { parseDecimalToMinor } from "@/lib/integrations/decimal";
import type { DiscountCodeParameters } from "@/lib/commerce/contract";

/**
 * The scope this provider needs, beyond the read scope P5-E established.
 *
 * `write_discounts` and nothing else. Notably NOT `write_orders`, NOT
 * `write_products`, NOT `write_customers`, and nothing in the payments family —
 * this token may create a discount and can do nothing else to the store.
 */
export const SHOPIFY_WRITE_SCOPE = "write_discounts";

/** Reading a discount back is a different scope from reading orders. */
export const SHOPIFY_DISCOUNT_READ_SCOPE = "read_discounts";

/**
 * Shorter than the read timeout, and that is deliberate.
 *
 * A read that times out can simply be repeated. A WRITE that times out may
 * already have happened, so every second spent waiting is a second in which the
 * outcome is ambiguous. The bound is tight enough to fail fast and long enough
 * that a healthy call completes.
 */
const WRITE_TIMEOUT_MS = 20_000;

const CREATE_DISCOUNT_MUTATION = `mutation VoxCreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          usageLimit
          appliesOncePerCustomer
          codes(first: 2) { nodes { code } }
          customerGets {
            value {
              ... on DiscountPercentage { percentage }
            }
          }
        }
      }
    }
    userErrors { field message code }
  }
}`;

const DISCOUNT_BY_CODE_QUERY = `query VoxDiscountByCode($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      ... on DiscountCodeBasic {
        title
        status
        startsAt
        endsAt
        usageLimit
        asyncUsageCount
        appliesOncePerCustomer
        codes(first: 2) { nodes { code } }
        customerGets {
          value {
            ... on DiscountPercentage { percentage }
          }
        }
      }
    }
  }
}`;

interface DiscountEcho {
  title?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimit?: unknown;
  asyncUsageCount?: unknown;
  appliesOncePerCustomer?: unknown;
  codes?: { nodes?: { code?: unknown }[] };
  customerGets?: { value?: { percentage?: unknown } };
}

/**
 * Whether the store's copy is the thing that was authorized.
 *
 * EVERY declared parameter is compared, not a representative sample. A check
 * that verified the code and the percentage but not the usage limit would pass
 * a code authorized for 10 redemptions that the store created as unlimited.
 *
 * The percentage comparison goes through the exact-decimal parser rather than
 * comparing two floats: Shopify returns `percentage` as a JSON number, and
 * `0.05 !== 0.05000000000000001` would report a spurious mismatch while
 * `Math.abs(a - b) < 0.01` would accept 5% as 5.9%. Scaling both to integer
 * basis points compares them exactly at the precision that matters.
 */
function echoMatches(echo: DiscountEcho, want: DiscountCodeParameters): { matches: boolean; reason: string } {
  const codes = (echo.codes?.nodes ?? []).map((n) => (typeof n?.code === "string" ? n.code.toUpperCase() : ""));
  if (codes.length !== 1 || codes[0] !== want.code) {
    return { matches: false, reason: `the store's code list is [${codes.join(", ")}], not exactly [${want.code}]` };
  }

  const percentage = echo.customerGets?.value?.percentage;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    return { matches: false, reason: "the store did not state a percentage" };
  }
  // Compared as integer basis points, exactly. 0.05 -> 500.
  const storeBp = parseDecimalToMinor(percentage.toFixed(4));
  const wantBp = parseDecimalToMinor(want.percentageFraction.toFixed(4));
  if (!storeBp || !wantBp || storeBp.minor !== wantBp.minor) {
    return {
      matches: false,
      reason: `the store's discount is ${percentage} where ${want.percentageFraction} was authorized`,
    };
  }

  if (echo.usageLimit !== want.usageLimit) {
    return { matches: false, reason: `the store's usage limit is ${String(echo.usageLimit)}, not ${want.usageLimit}` };
  }
  if (echo.appliesOncePerCustomer !== want.appliesOncePerCustomer) {
    return { matches: false, reason: "the store's per-customer restriction differs from the authorized one" };
  }
  if (typeof echo.title !== "string" || echo.title !== want.title) {
    return { matches: false, reason: "the store's title differs from the authorized one" };
  }

  for (const [label, storeValue, wantValue] of [
    ["start", echo.startsAt, want.startsAt],
    ["end", echo.endsAt, want.endsAt],
  ] as const) {
    if (typeof storeValue !== "string") return { matches: false, reason: `the store did not state an ${label} time` };
    const parsed = new Date(storeValue);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() !== wantValue.getTime()) {
      return { matches: false, reason: `the store's ${label} time differs from the authorized one` };
    }
  }

  return { matches: true, reason: "every authorized parameter matches the store's copy" };
}

export class ShopifyCommerceProvider implements CommercialWriteProvider {
  readonly provider = "shopify";

  private refused(failure: WriteFailure, detail: string): WriteRefused {
    return { outcome: "REFUSED", failure, detail, provider: this.provider, attemptedAt: new Date() };
  }

  private unknown(failure: WriteFailure, detail: string): WriteUnknown {
    return { outcome: "UNKNOWN", failure, detail, provider: this.provider, attemptedAt: new Date() };
  }

  /**
   * One POST.
   *
   * `submitted` is the field that matters: it says whether the request left this
   * process. A failure BEFORE submission can be reported as a refusal, because
   * nothing can have happened. A failure AFTER submission cannot — the caller
   * has to treat it as unknown.
   */
  private async post(
    scope: string,
    accessToken: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<
    | { ok: true; raw: string; data: Record<string, unknown> }
    | { ok: false; submitted: boolean; failure: WriteFailure; detail: string }
  > {
    const url = `https://${scope}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    let response: Response;
    let raw: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      // THE AMBIGUOUS CASE. The request was handed to the network. A timeout or
      // a reset says the ANSWER did not come back; it says nothing at all about
      // whether the store processed it.
      return {
        ok: false,
        submitted: true,
        failure: "PROVIDER_UNAVAILABLE",
        detail: "Shopify could not be reached, or did not answer in time. Whether the request was processed is unknown.",
      };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      // An authentication failure is decided before any mutation runs, so this
      // one is genuinely a refusal rather than an ambiguity.
      return {
        ok: false,
        submitted: false,
        failure: "PROVIDER_REJECTED",
        detail: "Shopify rejected the access token. It may have been revoked, or may not carry the write_discounts scope.",
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        submitted: false,
        failure: "PROVIDER_THROTTLED",
        detail: "Shopify is throttling requests to this store. Nothing was created.",
      };
    }
    if (!response.ok) {
      // A 5xx is ambiguous: the mutation may have run before the failure.
      const ambiguous = response.status >= 500;
      return {
        ok: false,
        submitted: ambiguous,
        failure: "PROVIDER_UNAVAILABLE",
        detail: `Shopify answered with HTTP ${response.status}.${ambiguous ? " Whether the request was processed is unknown." : " Nothing was created."}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A 200 whose body cannot be read. The mutation may well have run.
      return {
        ok: false,
        submitted: true,
        failure: "RESPONSE_UNREADABLE",
        detail: "Shopify's response was not readable JSON, so what it did is unknown.",
      };
    }

    const body = parsed as { data?: Record<string, unknown> | null; errors?: unknown };

    if (body.errors !== undefined && body.errors !== null) {
      const lowered = raw.toLowerCase();
      if (lowered.includes("throttled") || lowered.includes("exceeded")) {
        return { ok: false, submitted: false, failure: "PROVIDER_THROTTLED", detail: "Shopify is throttling this store. Nothing was created." };
      }
      if (lowered.includes("access denied") || lowered.includes("required access")) {
        return {
          ok: false,
          submitted: false,
          failure: "PROVIDER_REJECTED",
          detail: "Shopify refused the request. The token may not carry the write_discounts scope.",
        };
      }
      // A GraphQL-level error under HTTP 200. Whether the mutation ran before
      // the error is not knowable from here.
      return {
        ok: false,
        submitted: true,
        failure: "RESPONSE_UNREADABLE",
        detail: "Shopify returned an error rather than a result, so what it did is unknown.",
      };
    }

    if (!body.data) {
      return { ok: false, submitted: true, failure: "RESPONSE_UNREADABLE", detail: "Shopify's response carried no data." };
    }

    return { ok: true, raw, data: body.data };
  }

  async createDiscountCode(request: DiscountWriteRequest): Promise<WriteOutcome> {
    if (!isValidShopDomain(request.scope)) {
      // Refused before anything leaves this process, so it cannot be ambiguous.
      return this.refused(
        "SCOPE_INVALID",
        "The stored store address is not a <name>.myshopify.com domain, so no request was made."
      );
    }

    const p = request.parameters;
    const variables = {
      basicCodeDiscount: {
        code: p.code,
        title: p.title,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
        usageLimit: p.usageLimit,
        appliesOncePerCustomer: p.appliesOncePerCustomer,
        // Every buyer. Stated explicitly rather than omitted — an absent
        // selection would let Shopify's default decide who the discount is for.
        context: { all: "ALL" },
        customerGets: {
          // A FRACTION. Shopify documents this field as 0.00-1.00, and
          // `validateDiscountParameters` refuses anything above 1 with its own
          // violation code so the units mistake cannot arrive here.
          value: { percentage: p.percentageFraction },
          items: { all: true },
        },
      },
    };

    const result = await this.post(request.scope, request.accessToken, CREATE_DISCOUNT_MUTATION, variables);
    if (!result.ok) {
      return result.submitted
        ? this.unknown(result.failure, result.detail)
        : this.refused(result.failure, result.detail);
    }

    const payload = result.data.discountCodeBasicCreate as
      | { codeDiscountNode?: { id?: unknown; codeDiscount?: DiscountEcho } | null; userErrors?: unknown }
      | undefined
      | null;

    if (!payload) {
      return this.unknown("RESPONSE_UNREADABLE", "Shopify's response carried no result for the mutation.");
    }

    // ---- userErrors, CHECKED BEFORE THE NODE ------------------------------
    //
    // This is the branch whose absence turns a validation failure into a
    // reported creation. A non-empty `userErrors` means the store declined the
    // request itself, which — unlike a timeout — is unambiguous: nothing exists.
    const userErrors = payload.userErrors;
    if (Array.isArray(userErrors) && userErrors.length > 0) {
      const first = userErrors[0] as { message?: unknown; code?: unknown };
      const code = typeof first?.code === "string" ? first.code : "";
      const message = typeof first?.message === "string" ? first.message : "Shopify declined the request.";
      if (code === "TAKEN" || /already exists|has already been taken/i.test(message)) {
        // The store already holds a code with this name. Reported distinctly
        // because it is the signature of a duplicate submission, and the right
        // response is to go and look at what is there — not to try again.
        return this.refused(
          "ALREADY_EXISTS",
          `A discount code named ${p.code} already exists in this store. Nothing new was created.`
        );
      }
      return this.refused("PROVIDER_DECLINED", `Shopify declined the request: ${message}`);
    }
    if (!Array.isArray(userErrors)) {
      return this.unknown("RESPONSE_UNREADABLE", "Shopify's response did not state whether the request was accepted.");
    }

    const node = payload.codeDiscountNode;
    const externalId = node?.id;
    if (!node || typeof externalId !== "string" || externalId.length === 0) {
      // No errors AND no node. Something happened that this code cannot
      // describe, and the honest answer is that the outcome is unknown.
      return this.unknown(
        "RESPONSE_UNREADABLE",
        "Shopify reported no errors but returned no discount, so whether one was created is unknown."
      );
    }

    // ---- A CONFIRMATION IS NOT A MATCH ------------------------------------
    const echo = node.codeDiscount;
    if (!echo) {
      return this.unknown(
        "RESPONSE_UNREADABLE",
        "Shopify returned a discount without its parameters, so what was created cannot be confirmed."
      );
    }
    const comparison = echoMatches(echo, p);
    if (!comparison.matches) {
      // NOT a success and NOT a plain failure: something now exists in the
      // merchant's store that does not match what was authorized.
      return this.unknown(
        "ECHO_MISMATCH",
        `Shopify created a discount that does not match what was authorized — ${comparison.reason}. It exists and needs a person to look at it.`
      );
    }

    return {
      outcome: "APPLIED",
      externalId,
      provider: this.provider,
      scope: request.scope,
      appliedAt: new Date(),
      responseDigest: writeResponseDigestOf(result.raw),
    };
  }

  /**
   * Asks the store whether the authorized discount exists, and whether its copy
   * matches.
   *
   * THIS IS THE ONLY WAY OUT OF AN UNKNOWN. Not a retry, not a timeout, not an
   * assumption about what probably happened. The store is the system of record
   * for its own discounts, so the question "did my write land" has exactly one
   * authoritative answer and this is how it is obtained.
   *
   * Note it returns `exists` and `matches` separately. A discount that exists
   * but does not match is a real and important third answer: the write landed,
   * in a shape nobody authorized.
   */
  async verifyDiscountCode(request: DiscountVerifyRequest): Promise<VerificationOutcome> {
    if (!isValidShopDomain(request.scope)) {
      return {
        verified: false,
        failure: "SCOPE_INVALID",
        detail: "The stored store address is not a <name>.myshopify.com domain, so no request was made.",
        provider: this.provider,
        checkedAt: new Date(),
      };
    }

    const result = await this.post(request.scope, request.accessToken, DISCOUNT_BY_CODE_QUERY, {
      code: request.parameters.code,
    });
    if (!result.ok) {
      // A failed verification establishes NOTHING. It does not mean the discount
      // is absent, and the caller must not read it as one.
      return {
        verified: false,
        failure: result.failure,
        detail: result.detail,
        provider: this.provider,
        checkedAt: new Date(),
      };
    }

    const node = result.data.codeDiscountNodeByCode as
      | { id?: unknown; codeDiscount?: DiscountEcho }
      | null
      | undefined;

    const checkedAt = new Date();
    const responseDigest = writeResponseDigestOf(result.raw);

    if (node === null) {
      // An explicit null from the store: no discount by this name. This is a
      // real answer, and it is what resolves an UNKNOWN write to "it did not
      // happen" — the one case where absence genuinely is evidence, because the
      // store was asked directly.
      return {
        verified: true,
        exists: false,
        matches: false,
        externalId: null,
        redemptions: null,
        detail: `No discount code named ${request.parameters.code} exists in this store.`,
        provider: this.provider,
        checkedAt,
        responseDigest,
      };
    }
    if (node === undefined || typeof node.id !== "string") {
      return {
        verified: false,
        failure: "RESPONSE_UNREADABLE",
        detail: "Shopify's answer about this discount could not be read, so whether it exists is still unknown.",
        provider: this.provider,
        checkedAt,
      };
    }

    const echo = node.codeDiscount;
    if (!echo) {
      return {
        verified: true,
        exists: true,
        matches: false,
        externalId: node.id,
        redemptions: null,
        detail: "A discount with this code exists, but the store did not describe it, so it cannot be confirmed as the authorized one.",
        provider: this.provider,
        checkedAt,
        responseDigest,
      };
    }

    const comparison = echoMatches(echo, request.parameters);
    const redemptions =
      typeof echo.asyncUsageCount === "number" && Number.isInteger(echo.asyncUsageCount) && echo.asyncUsageCount >= 0
        ? echo.asyncUsageCount
        : null;

    return {
      verified: true,
      exists: true,
      matches: comparison.matches,
      externalId: node.id,
      // A COUNT OF REDEMPTIONS. Not revenue, not an amount, not a result — how
      // many times a code was used, and nothing whatsoever about what those
      // uses were worth or whether they would have happened anyway.
      redemptions,
      detail: comparison.reason,
      provider: this.provider,
      checkedAt,
      responseDigest,
    };
  }
}

export const shopifyCommerceProvider = new ShopifyCommerceProvider();
registerCommercialWriteProvider(shopifyCommerceProvider);
