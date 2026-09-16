/**
 * [P5-E] SHOPIFY — VOX's first real (non-stub) external provider.
 *
 * Read-only. One query. It asks a merchant's own store how many orders it
 * recorded inside a declared window, and it can do nothing else: there is no
 * mutation in this file, and the OAuth scope it requires (`read_orders`) does
 * not permit one.
 *
 * Verified against the live Admin GraphQL schema before being written, per
 * CLAUDE.md rule 1 — `ordersCount` returns a `Count { count precision }` where
 * `CountPrecision` is `EXACT | AT_LEAST`, and `created_at` is a `time` field
 * filterable with comparators. None of that is assumed.
 *
 * ---------------------------------------------------------------------------
 * THE HAZARD THIS FILE IS MOSTLY ABOUT
 * ---------------------------------------------------------------------------
 *
 * SHOPIFY RETURNS MANY ERRORS AS HTTP 200 WITH AN `errors[]` BODY. GraphQL does
 * this by design: a throttled request, an unknown field, an insufficient scope —
 * all of them can arrive as a perfectly successful HTTP response whose body
 * happens to contain no data. So `response.ok` proves nothing, and the natural
 * implementation —
 *
 *     const json = await response.json();
 *     return json.data?.ordersCount?.count ?? 0;
 *
 * — reports a throttled store as a store that made no sales. Every branch below
 * that looks paranoid exists because of that one line.
 */

import {
  registerEconomicProvider,
  responseDigestOf,
  type EconomicObservationProvider,
  type ObservationFailure,
  type ObservationOutcome,
  type ObservationRefusal,
  type OrderCountQuery,
} from "@/lib/integrations/economic";

/**
 * Pinned, not "latest".
 *
 * `latest` silently moves a production integration onto a new API whenever
 * Shopify ships one, which turns a schema change into a runtime failure nobody
 * deployed. Verified current stable at the time of writing.
 */
export const SHOPIFY_API_VERSION = "2026-07";

/**
 * The only scope this provider needs.
 *
 * `read_orders` and nothing else. Notably NOT `write_orders`, and not
 * `read_reports` — the latter would be required for ShopifyQL aggregates, which
 * were considered and rejected: they also require Level 2 protected-customer-data
 * access, and they return money as a bare string with no currency column.
 */
export const SHOPIFY_REQUIRED_SCOPE = "read_orders";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The query. A constant, not a template built at call time.
 *
 * Only the FILTER is a variable, and it is built by `buildWindowFilter()` from
 * two Dates — no caller-supplied string reaches the query text. A query
 * assembled from caller input is a query a caller can extend.
 */
const ORDERS_COUNT_QUERY = `query VoxOrderCount($filter: String!) {
  ordersCount(query: $filter, limit: null) {
    count
    precision
  }
}`;

/**
 * Shop domains this provider will talk to.
 *
 * `<name>.myshopify.com` ONLY. This is the SSRF boundary: the scope comes out of
 * the database, and a permissive check would let a stored value point the
 * authenticated request at an arbitrary host — including a link-local metadata
 * endpoint — with a real access token in the header.
 *
 * The regex pins the whole string (no `.myshopify.com.evil.test`), forbids a
 * leading or trailing hyphen, and allows no port, no path, no userinfo and no
 * scheme, because the URL is built from this value plus a fixed prefix and
 * suffix below.
 */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/;

export function isValidShopDomain(scope: string): boolean {
  return SHOP_DOMAIN.test(scope);
}

/**
 * The window as Shopify search syntax: inclusive start, EXCLUSIVE end.
 *
 * `>=` and `<`, never `<=`. With an inclusive upper bound two consecutive
 * windows both claim an order landing exactly on the boundary, and two
 * experiments then report a combined total larger than the store's own.
 *
 * ISO-8601 with an explicit `Z`. A bare date would be interpreted in the shop's
 * local timezone, which would silently shift every window by up to a day.
 */
export function buildWindowFilter(windowStart: Date, windowEnd: Date): string {
  return `created_at:>='${windowStart.toISOString()}' AND created_at:<'${windowEnd.toISOString()}'`;
}

/**
 * Maps a GraphQL error code onto a failure this system distinguishes.
 *
 * `THROTTLED` is separated from a general failure because the instruction to a
 * person differs: one means wait, the other means something is wrong.
 */
function failureForErrorCode(body: string): { failure: ObservationFailure; detail: string } {
  const lowered = body.toLowerCase();
  if (lowered.includes("throttled") || lowered.includes("exceeded") || lowered.includes("rate limit")) {
    return {
      failure: "PROVIDER_THROTTLED",
      detail: "Shopify is throttling requests to this store. The window can be observed again shortly.",
    };
  }
  if (
    lowered.includes("access denied") ||
    lowered.includes("unauthorized") ||
    lowered.includes("required access") ||
    lowered.includes("merchant approval")
  ) {
    return {
      failure: "PROVIDER_REJECTED",
      detail:
        "Shopify refused the request for this store. The access token may have been revoked, or it may not carry the read_orders scope.",
    };
  }
  return {
    failure: "PROVIDER_UNAVAILABLE",
    detail: "Shopify returned an error rather than a count. No number was obtained.",
  };
}

export class ShopifyOrderCountProvider implements EconomicObservationProvider {
  readonly provider = "shopify";
  readonly unit = "orders created in the observation window";

  private refusal(failure: ObservationFailure, detail: string): ObservationRefusal {
    return { observed: false, failure, detail, provider: this.provider, attemptedAt: new Date() };
  }

  async countOrdersInWindow(query: OrderCountQuery): Promise<ObservationOutcome> {
    if (!isValidShopDomain(query.scope)) {
      return this.refusal(
        "SCOPE_INVALID",
        "The stored store address is not a <name>.myshopify.com domain, so no request was made."
      );
    }
    if (query.windowEnd.getTime() <= query.windowStart.getTime()) {
      return this.refusal("NO_CONTRACT", "The observation window has no duration.");
    }

    const filter = buildWindowFilter(query.windowStart, query.windowEnd);

    // Built from a validated domain plus fixed literals. Nothing the caller
    // supplies reaches the scheme, the port, the path or the API version.
    const url = `https://${query.scope}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    let response: Response;
    let raw: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": query.accessToken,
        },
        body: JSON.stringify({ query: ORDERS_COUNT_QUERY, variables: { filter } }),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      // Network failure, DNS failure, or the timeout firing. Deliberately does
      // not echo the error: a fetch error message can contain the full URL.
      return this.refusal(
        "PROVIDER_UNAVAILABLE",
        "Shopify could not be reached, or did not answer in time. No number was obtained."
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      return this.refusal(
        "PROVIDER_REJECTED",
        "Shopify rejected the access token for this store. It may have been revoked or may lack the read_orders scope."
      );
    }
    if (response.status === 429) {
      return this.refusal(
        "PROVIDER_THROTTLED",
        "Shopify is throttling requests to this store. The window can be observed again shortly."
      );
    }
    if (!response.ok) {
      return this.refusal(
        "PROVIDER_UNAVAILABLE",
        `Shopify answered with HTTP ${response.status}. No number was obtained.`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.refusal("PROVIDER_UNAVAILABLE", "Shopify's response was not readable JSON.");
    }

    const body = parsed as {
      data?: { ordersCount?: { count?: unknown; precision?: unknown } | null } | null;
      errors?: unknown;
    };

    // ---- THE HTTP-200 ERROR ------------------------------------------------
    //
    // Checked BEFORE the data is read, because a GraphQL response may legally
    // carry both. A body with errors is not a body to take a number out of.
    if (body.errors !== undefined && body.errors !== null) {
      const { failure, detail } = failureForErrorCode(raw);
      return this.refusal(failure, detail);
    }

    const count = body.data?.ordersCount?.count;
    const precision = body.data?.ordersCount?.precision;

    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      // Includes the case where `data` or `ordersCount` is null — which Shopify
      // returns on some permission failures with a 200 and no errors array.
      return this.refusal(
        "PROVIDER_UNAVAILABLE",
        "Shopify's response carried no whole-number count. No number was obtained."
      );
    }

    // ---- EXACT, OR NOTHING -------------------------------------------------
    //
    // `AT_LEAST` means Shopify hit an internal limit and stopped counting. The
    // figure is a lower bound. Recording a lower bound as a measurement would
    // put a number in the evidence chain that is quietly not the answer to the
    // question asked, and no downstream surface could tell.
    if (precision !== "EXACT") {
      return this.refusal(
        "IMPRECISE_RESULT",
        `Shopify returned a ${String(precision)} count rather than an exact one. A lower bound is not a measurement.`
      );
    }

    return {
      observed: true,
      value: count,
      unit: this.unit,
      provider: this.provider,
      scope: query.scope,
      retrievedAt: new Date(),
      responseDigest: responseDigestOf(raw),
      windowStart: query.windowStart,
      windowEnd: query.windowEnd,
      semantics: "DELTA_OVER_WINDOW",
    };
  }
}

export const shopifyOrderCountProvider = new ShopifyOrderCountProvider();
registerEconomicProvider(shopifyOrderCountProvider);

/**
 * Proves a credential actually works before a connection is called CONNECTED.
 *
 * Per CLAUDE.md rule 10, a service may only report a successful connection when
 * it really has one. So `connectShopifyStore()` performs this real, authenticated
 * read against the real store before storing anything — a token that does not
 * work never reaches CONNECTED, and the Connections Hub never shows a store VOX
 * cannot actually talk to.
 *
 * It asks for a one-minute window in the distant past deliberately: the cheapest
 * question that still exercises authentication, the scope, and the response
 * shape, while being nearly certain to return zero. The ANSWER is discarded —
 * only whether the store answered at all is used.
 */
export async function verifyShopifyCredential(
  scope: string,
  accessToken: string
): Promise<{ verified: true } | { verified: false; failure: ObservationFailure; detail: string }> {
  const probeStart = new Date(Date.UTC(2015, 0, 1, 0, 0, 0));
  const probeEnd = new Date(Date.UTC(2015, 0, 1, 0, 1, 0));

  const outcome = await shopifyOrderCountProvider.countOrdersInWindow({
    scope,
    accessToken,
    windowStart: probeStart,
    windowEnd: probeEnd,
  });

  if (outcome.observed) return { verified: true };
  return { verified: false, failure: outcome.failure, detail: outcome.detail };
}
