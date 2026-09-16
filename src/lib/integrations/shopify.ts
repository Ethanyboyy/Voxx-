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
  type ValueObservationOutcome,
} from "@/lib/integrations/economic";
import { parseDecimalToMinor, sumDecimals, type ParsedDecimal } from "@/lib/integrations/decimal";

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

/**
 * [P5-F] The value query.
 *
 * THREE ANSWERS IN ONE ROUND TRIP, and each one is load-bearing:
 *
 *   `shop.currencyCode`  the store's own base currency, so the denomination is
 *                        read rather than assumed
 *   `ordersCount`        the store's OWN count for the same filter — the
 *                        completeness oracle the page-walk is checked against
 *   `orders`             the page of orders whose totals are summed
 *
 * `totalPriceSet` AND NOT `currentTotalPriceSet`, deliberately. Shopify's own
 * documentation defines every `current*` money field as the value "after
 * returns, refunds, order edits, and cancellations" — which means it DRIFTS.
 * The same order yields a different figure next month, so a measurement built
 * from it would silently stop matching its own digest and could never be
 * re-verified. `totalPriceSet` is the value at order time and does not move.
 *
 * The cost of that choice is real and is disclosed rather than hidden: a fully
 * refunded order still counts at its full value here. This is GROSS ORDER VALUE
 * AT ORDER TIME. It is not net, and it is not revenue.
 */
const ORDER_VALUE_QUERY = `query VoxOrderValue($filter: String!, $after: String) {
  shop { currencyCode }
  ordersCount(query: $filter, limit: null) {
    count
    precision
  }
  orders(first: 100, after: $after, query: $filter, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        totalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
}`;

/**
 * How many pages of 100 orders the sum will walk before giving up.
 *
 * 4,000 orders. A bound is needed because the alternative is an unbounded loop
 * against a third party holding an open credential. Hitting it is a REFUSAL, not
 * a truncated total — a partial sum is a smaller number that looks exactly like
 * a real one, which is the single most dangerous thing this function could
 * return.
 */
const MAX_VALUE_PAGES = 40;

interface OrderEdge {
  node?: { id?: unknown; totalPriceSet?: { shopMoney?: { amount?: unknown; currencyCode?: unknown } } };
}

export class ShopifyOrderCountProvider implements EconomicObservationProvider {
  readonly provider = "shopify";
  readonly unit = "orders created in the observation window";
  readonly valueUnit = "total price of orders created in the observation window, at order time and before returns";

  private refusal(failure: ObservationFailure, detail: string): ObservationRefusal {
    return { observed: false, failure, detail, provider: this.provider, attemptedAt: new Date() };
  }

  /**
   * One POST, one error taxonomy.
   *
   * Extracted so the count read and the value read cannot disagree about what a
   * throttle, a 401 or an HTTP-200 `errors[]` body means. Two copies of this
   * would be two chances to forget that `response.ok` proves nothing.
   */
  private async post(
    scope: string,
    accessToken: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ ok: true; raw: string; data: Record<string, unknown> } | { ok: false; refusal: ObservationRefusal }> {
    const url = `https://${scope}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    let response: Response;
    let raw: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      return {
        ok: false,
        refusal: this.refusal(
          "PROVIDER_UNAVAILABLE",
          "Shopify could not be reached, or did not answer in time. No number was obtained."
        ),
      };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        refusal: this.refusal(
          "PROVIDER_REJECTED",
          "Shopify rejected the access token for this store. It may have been revoked or may lack the read_orders scope."
        ),
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        refusal: this.refusal(
          "PROVIDER_THROTTLED",
          "Shopify is throttling requests to this store. The window can be observed again shortly."
        ),
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        refusal: this.refusal(
          "PROVIDER_UNAVAILABLE",
          `Shopify answered with HTTP ${response.status}. No number was obtained.`
        ),
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, refusal: this.refusal("PROVIDER_UNAVAILABLE", "Shopify's response was not readable JSON.") };
    }

    const body = parsed as { data?: Record<string, unknown> | null; errors?: unknown };

    // THE HTTP-200 ERROR. Checked before the data is read, because a GraphQL
    // response may legally carry both and a body with errors is not a body to
    // take a number out of.
    if (body.errors !== undefined && body.errors !== null) {
      const { failure, detail } = failureForErrorCode(raw);
      return { ok: false, refusal: this.refusal(failure, detail) };
    }
    if (!body.data) {
      return {
        ok: false,
        refusal: this.refusal("PROVIDER_UNAVAILABLE", "Shopify's response carried no data. No number was obtained."),
      };
    }

    return { ok: true, raw, data: body.data };
  }

  /**
   * Checks that apply to BOTH reads, before any request is made.
   *
   * Returns a refusal or null. Shared so the value read cannot accidentally be
   * less careful about the SSRF boundary than the count read is.
   */
  private preflight(query: OrderCountQuery): ObservationRefusal | null {
    if (!isValidShopDomain(query.scope)) {
      return this.refusal(
        "SCOPE_INVALID",
        "The stored store address is not a <name>.myshopify.com domain, so no request was made."
      );
    }
    if (query.windowEnd.getTime() <= query.windowStart.getTime()) {
      return this.refusal("NO_CONTRACT", "The observation window has no duration.");
    }
    return null;
  }

  async countOrdersInWindow(query: OrderCountQuery): Promise<ObservationOutcome> {
    const preflight = this.preflight(query);
    if (preflight) return preflight;

    const filter = buildWindowFilter(query.windowStart, query.windowEnd);
    const result = await this.post(query.scope, query.accessToken, ORDERS_COUNT_QUERY, { filter });
    if (!result.ok) return result.refusal;

    const data = result.data as { ordersCount?: { count?: unknown; precision?: unknown } | null };
    const count = data.ordersCount?.count;
    const precision = data.ordersCount?.precision;

    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return this.refusal(
        "PROVIDER_UNAVAILABLE",
        "Shopify's response carried no whole-number count. No number was obtained."
      );
    }

    // EXACT, OR NOTHING. `AT_LEAST` means Shopify hit an internal limit and
    // stopped counting, so the figure is a lower bound. Recording a lower bound
    // as a measurement would put a number in the evidence chain that is quietly
    // not the answer to the question asked, and no surface could tell.
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
      responseDigest: responseDigestOf(result.raw),
      windowStart: query.windowStart,
      windowEnd: query.windowEnd,
      semantics: "DELTA_OVER_WINDOW",
    };
  }

  /**
   * [P5-F] The total monetary value of the orders in the declared window.
   *
   * -------------------------------------------------------------------------
   * WHY THIS IS HARDER TO SATISFY THAN THE COUNT
   * -------------------------------------------------------------------------
   *
   * A count comes back as one integer from one field, with the store's own
   * precision flag attached. A value has to be ASSEMBLED — page through the
   * orders, parse each total, add them up — and every step of that assembly is a
   * way to produce a plausible number that is wrong:
   *
   *   an unread last page        a smaller total that looks entirely real
   *   a mixed-currency window    a meaningless sum of unlike things
   *   an assumed 2 decimals      a 100x error on JPY, a 10x error on KWD
   *   float addition             wrong in the last places, invisibly
   *   an order created mid-read  a total that matches no fixed window
   *
   * So five things must ALL hold, and the absence of any one is a refusal rather
   * than a partial answer. There is no "best effort" total here.
   *
   *   COMPLETENESS  the orders summed must equal the store's OWN count for the
   *                 same filter. Two independent answers from the provider have
   *                 to agree before either is believed.
   *   STABILITY     that count must not move between the first page and the
   *                 last, or the window was changing while it was being read.
   *   ONE CURRENCY  the shop's base currency and every order's currency must be
   *                 the same single code.
   *   EXACTNESS     every amount parses as an exact decimal at a real currency
   *                 scale, summed as integers.
   *   BOUNDEDNESS   the page walk and the total both stay inside sane limits.
   */
  async sumOrderValueInWindow(query: OrderCountQuery): Promise<ValueObservationOutcome> {
    const preflight = this.preflight(query);
    if (preflight) return preflight;

    const filter = buildWindowFilter(query.windowStart, query.windowEnd);

    const amounts: ParsedDecimal[] = [];
    const seenOrderIds = new Set<string>();
    const rawPages: string[] = [];
    let currency: string | null = null;
    let declaredCount: number | null = null;
    let after: string | null = null;

    for (let page = 0; page < MAX_VALUE_PAGES; page++) {
      const result = await this.post(query.scope, query.accessToken, ORDER_VALUE_QUERY, { filter, after });
      if (!result.ok) return result.refusal;
      rawPages.push(result.raw);

      const data = result.data as {
        shop?: { currencyCode?: unknown };
        ordersCount?: { count?: unknown; precision?: unknown } | null;
        orders?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }; edges?: unknown } | null;
      };

      // ---- THE SHOP'S OWN CURRENCY, READ NOT ASSUMED ----------------------
      const shopCurrency = data.shop?.currencyCode;
      if (typeof shopCurrency !== "string" || !/^[A-Z]{3}$/.test(shopCurrency)) {
        return this.refusal(
          "CURRENCY_AMBIGUOUS",
          "Shopify did not state the store's currency, so any total would be a number without a denomination."
        );
      }
      if (currency === null) currency = shopCurrency;
      if (currency !== shopCurrency) {
        return this.refusal("CURRENCY_AMBIGUOUS", "The store's currency changed while the window was being read.");
      }

      // ---- THE COMPLETENESS ORACLE ----------------------------------------
      const count = data.ordersCount?.count;
      const precision = data.ordersCount?.precision;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        return this.refusal(
          "PROVIDER_UNAVAILABLE",
          "Shopify did not state how many orders the window holds, so a sum could not be checked for completeness."
        );
      }
      if (precision !== "EXACT") {
        return this.refusal(
          "IMPRECISE_RESULT",
          `Shopify returned a ${String(precision)} order count, so a sum could not be proven complete.`
        );
      }
      if (declaredCount === null) declaredCount = count;
      if (declaredCount !== count) {
        // STABILITY. The window is in the past, so its contents should not move;
        // if they did, something is being edited underneath the read and the
        // total would describe no fixed set of orders.
        return this.refusal(
          "RESULT_UNSTABLE",
          "The store's own count of this window changed while its orders were being read. No stable total exists to record."
        );
      }
      if (count > MAX_VALUE_PAGES * 100) {
        return this.refusal(
          "RESULT_SET_TOO_LARGE",
          `This window holds ${count} orders, more than this observation will page through. A partial sum would look like a real one, so none is produced.`
        );
      }

      const edges = data.orders?.edges;
      if (!Array.isArray(edges)) {
        return this.refusal("PROVIDER_UNAVAILABLE", "Shopify's response carried no order list.");
      }

      for (const edge of edges as OrderEdge[]) {
        const id = edge?.node?.id;
        if (typeof id !== "string" || id.length === 0) {
          return this.refusal("PROVIDER_UNAVAILABLE", "An order in Shopify's response carried no identity.");
        }
        // A cursor that repeats would otherwise double-count real orders into a
        // larger, entirely plausible total.
        if (seenOrderIds.has(id)) {
          return this.refusal(
            "RESULT_UNSTABLE",
            "Shopify returned the same order twice while paging. A total from that would count real orders more than once."
          );
        }
        seenOrderIds.add(id);

        const money = edge?.node?.totalPriceSet?.shopMoney;
        const amountCurrency = money?.currencyCode;
        if (typeof amountCurrency !== "string" || amountCurrency !== currency) {
          // ONE CURRENCY. Summing across currencies produces a number that is
          // not an amount of anything.
          return this.refusal(
            "CURRENCY_AMBIGUOUS",
            `An order in this window is denominated in ${String(amountCurrency)} rather than ${currency}. A sum across currencies is not a monetary value.`
          );
        }

        const parsed = parseDecimalToMinor(money?.amount);
        if (!parsed) {
          return this.refusal(
            "IMPRECISE_VALUE",
            "An order total was not an exact decimal amount. Rounding or guessing it would turn an estimate into a recorded economic fact."
          );
        }
        amounts.push(parsed);
      }

      const hasNextPage = data.orders?.pageInfo?.hasNextPage === true;
      const endCursor = data.orders?.pageInfo?.endCursor;
      if (!hasNextPage) {
        after = null;
        break;
      }
      if (typeof endCursor !== "string" || endCursor.length === 0) {
        return this.refusal(
          "INCOMPLETE_RESULT",
          "Shopify reported more orders but gave no cursor to reach them. The remaining orders cannot be read, so no total is produced."
        );
      }
      after = endCursor;
    }

    if (after !== null) {
      // The loop ran out of pages rather than out of orders.
      return this.refusal(
        "RESULT_SET_TOO_LARGE",
        "This window holds more orders than this observation will page through. No partial total is recorded."
      );
    }
    if (currency === null || declaredCount === null) {
      return this.refusal("PROVIDER_UNAVAILABLE", "Shopify returned nothing to sum.");
    }

    // ---- COMPLETENESS, CHECKED --------------------------------------------
    //
    // The single most important line in this method. Without it, a page-walk
    // that silently stopped early returns a smaller total that is
    // indistinguishable from a real one — and nothing downstream could ever
    // detect it.
    if (amounts.length !== declaredCount) {
      return this.refusal(
        "INCOMPLETE_RESULT",
        `Shopify says this window holds ${declaredCount} orders but only ${amounts.length} could be read. A total over the wrong set of orders is not a measurement.`
      );
    }

    const summed = sumDecimals(amounts);
    if (!summed.summed) {
      return this.refusal(
        summed.failure,
        summed.failure === "AMOUNT_OUT_OF_RANGE"
          ? "The total for this window is larger than can be recorded exactly. A truncated monetary total is worse than none."
          : "An order total carried more decimal places than any real currency uses, so the sum would be an unrounded computed figure rather than money."
      );
    }

    return {
      observed: true,
      amountMinor: summed.minor,
      amountScale: summed.scale,
      currency,
      orderCount: amounts.length,
      unit: this.valueUnit,
      provider: this.provider,
      scope: query.scope,
      retrievedAt: new Date(),
      // Every page, in order. The digest covers the whole retrieval rather than
      // its last page, so re-reading one page differently is detectable.
      responseDigest: responseDigestOf(rawPages.join("\n")),
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
