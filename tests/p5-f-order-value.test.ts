/**
 * [P5-F] VALUE, NOT JUST VOLUME — adversarial tests.
 *
 * The question is no longer "can a number that nobody measured become evidence".
 * It is narrower and harder: CAN A MONETARY TOTAL BE WRONG IN A WAY THAT LOOKS
 * RIGHT? Money has failure modes a count does not — a dropped page is a smaller
 * total that reads as real, an assumed scale is a 100x error that renders
 * plausibly, and a currency label is the difference between ¥1,250 and $1,250.
 *
 * As in P5-E there is no mock provider in `src/`: `globalThis.fetch` is stubbed
 * and the real `ShopifyOrderCountProvider` does the parsing.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import {
  formatMinor,
  parseDecimalToMinor,
  rescale,
  sumDecimals,
  MAX_AMOUNT_MINOR,
  MAX_MONEY_SCALE,
} from "@/lib/integrations/decimal";
import { ShopifyOrderCountProvider } from "@/lib/integrations/shopify";
import { connectShopifyStore } from "@/lib/connections/shopify";
import {
  declareObservationContract,
  observeDeclaredOrderValue,
  EXTERNAL_ORDER_VALUE_RULE,
} from "@/lib/economic/externalObservation";
import {
  OBSERVATION_RULES,
  measurementDigest,
  observeExperimentExecution,
  getExperimentEvidence,
  verifyEvidenceIntegrity,
} from "@/lib/economic/evidence";
import { classifyAction } from "@/lib/policy/classification";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

const SHOP = "vox-value-store.myshopify.com";
const TOKEN = "shpat_valuetoken0123456789";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Queues a sequence of GraphQL bodies, one per POST. */
function stubPages(bodies: unknown[], status = 200) {
  let index = 0;
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

/** A well-formed value page. */
function valuePage(opts: {
  amounts: string[];
  currency?: string;
  count?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
  shopCurrency?: string;
  idPrefix?: string;
  precision?: string;
  amountCurrencies?: string[];
}) {
  const currency = opts.currency ?? "USD";
  return {
    data: {
      shop: { currencyCode: opts.shopCurrency ?? currency },
      ordersCount: { count: opts.count ?? opts.amounts.length, precision: opts.precision ?? "EXACT" },
      orders: {
        pageInfo: {
          hasNextPage: opts.hasNextPage ?? false,
          endCursor: opts.endCursor === undefined ? "cursor-1" : opts.endCursor,
        },
        edges: opts.amounts.map((amount, i) => ({
          node: {
            id: `gid://shopify/Order/${opts.idPrefix ?? "o"}${i}`,
            totalPriceSet: {
              shopMoney: { amount, currencyCode: opts.amountCurrencies?.[i] ?? currency },
            },
          },
        })),
      },
    },
  };
}

function sumValue(query = { scope: SHOP, accessToken: TOKEN, windowStart: new Date("2026-01-01T00:00:00Z"), windowEnd: new Date("2026-01-08T00:00:00Z") }) {
  return new ShopifyOrderCountProvider().sumOrderValueInWindow(query);
}

let user: User;
beforeAll(async () => {
  user = await createTestUser();
});

// ---------------------------------------------------------------------------
// Exact decimals
// ---------------------------------------------------------------------------

describe("money is parsed exactly, never as a float", () => {
  it("reads digits as text and keeps the provider's scale", () => {
    expect(parseDecimalToMinor("12.99")).toEqual({ minor: BigInt(1299), scale: 2 });
    expect(parseDecimalToMinor("5000")).toEqual({ minor: BigInt(5000), scale: 0 });
    expect(parseDecimalToMinor("5.000")).toEqual({ minor: BigInt(5000), scale: 3 });
    expect(parseDecimalToMinor("0.00")).toEqual({ minor: BigInt(0), scale: 2 });
  });

  it("does not lose precision the way float addition does", () => {
    // parseFloat("0.10") + parseFloat("0.20") === 0.30000000000000004
    const summed = sumDecimals([parseDecimalToMinor("0.10")!, parseDecimalToMinor("0.20")!]);
    expect(summed).toEqual({ summed: true, minor: 30, scale: 2 });
  });

  it("stays exact over many orders where float addition drifts", () => {
    const amounts = Array.from({ length: 1000 }, () => parseDecimalToMinor("0.07")!);
    const summed = sumDecimals(amounts);
    expect(summed.summed && summed.minor).toBe(7000);
    // The float version of the same sum is not 70.
    const floatTotal = amounts.reduce((acc) => acc + 0.07, 0);
    expect(floatTotal).not.toBe(70);
  });

  it("rejects every shape that would silently become a wrong number", () => {
    for (const bad of ["1e3", "1,234.00", " 12.00 ", "12.", "-5.00", "", "abc", "12.00.00", "٣.٠٠", null, 12.99]) {
      expect(parseDecimalToMinor(bad as unknown), String(bad)).toBeNull();
    }
  });

  it("rejects more decimal places than any real currency uses", () => {
    expect(parseDecimalToMinor("1.00000")).toBeNull();
    expect(parseDecimalToMinor("1.0000")).toEqual({ minor: BigInt(10000), scale: 4 });
  });

  it("sums at the LARGEST scale so nothing is rounded on the way in", () => {
    // 2-place and 3-place amounts together sum at 3, widening the 2s rather
    // than trimming the 3.
    const summed = sumDecimals([parseDecimalToMinor("1.50")!, parseDecimalToMinor("2.005")!]);
    expect(summed).toEqual({ summed: true, minor: 3505, scale: 3 });
  });

  it("handles a zero-decimal currency without inventing cents", () => {
    // ¥5,000 is 5000 at scale 0. A system that multiplied by 100 would record
    // ¥500,000 — a 100x error that looks like plausible money.
    const summed = sumDecimals([parseDecimalToMinor("5000")!]);
    expect(summed).toEqual({ summed: true, minor: 5000, scale: 0 });
    expect(formatMinor(5000, 0, "JPY")).toBe("5000 JPY");
  });

  it("handles a three-decimal currency without a 10x error", () => {
    const summed = sumDecimals([parseDecimalToMinor("5.000")!]);
    expect(summed.summed && summed.minor).toBe(5000);
    expect(formatMinor(5000, 3, "KWD")).toBe("5.000 KWD");
  });

  it("an empty window sums to a real zero", () => {
    expect(sumDecimals([])).toEqual({ summed: true, minor: 0, scale: 0 });
  });

  it("refuses a total too large to record exactly", () => {
    const huge = { minor: BigInt(MAX_AMOUNT_MINOR) + BigInt(1), scale: 0 };
    expect(sumDecimals([huge])).toEqual({ summed: false, failure: "AMOUNT_OUT_OF_RANGE" });
  });

  it("never widens by discarding digits", () => {
    expect(() => rescale({ minor: BigInt(1234), scale: 3 }, 2)).toThrow();
    expect(rescale({ minor: BigInt(12), scale: 0 }, 2)).toBe(BigInt(1200));
  });

  it("formats with a currency code, never an assumed symbol", () => {
    expect(formatMinor(1299, 2, "EUR")).toBe("12.99 EUR");
    expect(formatMinor(1299, 2, "EUR")).not.toContain("$");
    expect(formatMinor(5, 2, "USD")).toBe("0.05 USD");
    expect(formatMinor(0, 2, "USD")).toBe("0.00 USD");
  });

  it("caps the scale at a real currency's worth of places", () => {
    expect(MAX_MONEY_SCALE).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Completeness — a partial sum is the worst failure mode
// ---------------------------------------------------------------------------

describe("a sum is refused unless it is provably complete", () => {
  it("sums a single complete page", async () => {
    stubPages([valuePage({ amounts: ["10.00", "5.50", "0.25"] })]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(1575);
    expect(outcome.amountScale).toBe(2);
    expect(outcome.currency).toBe("USD");
    expect(outcome.orderCount).toBe(3);
  });

  it("walks every page and sums all of them", async () => {
    stubPages([
      valuePage({ amounts: ["10.00", "5.00"], count: 4, hasNextPage: true, endCursor: "c1", idPrefix: "a" }),
      valuePage({ amounts: ["1.00", "2.00"], count: 4, hasNextPage: false, idPrefix: "b" }),
    ]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(1800);
    expect(outcome.orderCount).toBe(4);
  });

  it("REFUSES when fewer orders were read than the store itself counts", async () => {
    // THE CENTRAL TEST OF THIS PHASE. The page walk stopped early — hasNextPage
    // false — but the store says the window holds 10 orders. The 2 that were
    // read sum to a perfectly plausible number that is simply not the answer.
    stubPages([valuePage({ amounts: ["10.00", "5.00"], count: 10, hasNextPage: false })]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("INCOMPLETE_RESULT");
    // And there is no amount to fall back on.
    expect("amountMinor" in outcome).toBe(false);
  });

  it("refuses when the store's own count moves between pages", async () => {
    stubPages([
      valuePage({ amounts: ["10.00"], count: 2, hasNextPage: true, endCursor: "c1", idPrefix: "a" }),
      valuePage({ amounts: ["5.00"], count: 3, hasNextPage: false, idPrefix: "b" }),
    ]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("RESULT_UNSTABLE");
  });

  it("refuses when the same order comes back twice", async () => {
    // A repeated cursor would otherwise double-count real orders into a larger,
    // entirely believable total.
    stubPages([
      valuePage({ amounts: ["10.00"], count: 2, hasNextPage: true, endCursor: "c1", idPrefix: "dup" }),
      valuePage({ amounts: ["10.00"], count: 2, hasNextPage: false, idPrefix: "dup" }),
    ]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("RESULT_UNSTABLE");
  });

  it("refuses when more pages are promised but no cursor is given", async () => {
    stubPages([valuePage({ amounts: ["10.00"], count: 5, hasNextPage: true, endCursor: null })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("INCOMPLETE_RESULT");
  });

  it("refuses a window with more orders than it will page through", async () => {
    stubPages([valuePage({ amounts: ["1.00"], count: 50_000, hasNextPage: true, endCursor: "c" })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("RESULT_SET_TOO_LARGE");
  });

  it("refuses when the store will not say how many orders the window holds", async () => {
    const page = valuePage({ amounts: ["10.00"] });
    (page.data as { ordersCount: unknown }).ordersCount = null;
    stubPages([page]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(false);
  });

  it("refuses an AT_LEAST count, because completeness could not be proven", async () => {
    stubPages([valuePage({ amounts: ["10.00"], precision: "AT_LEAST" })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("IMPRECISE_RESULT");
  });

  it("refuses an order with no identity, since duplicates could not be detected", async () => {
    const page = valuePage({ amounts: ["10.00"] });
    delete (page.data.orders.edges[0].node as { id?: unknown }).id;
    stubPages([page]);
    expect((await sumValue()).observed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

describe("a total without one unambiguous currency is refused", () => {
  it("refuses a window holding two currencies", async () => {
    // 10 USD + 5 EUR is not 15 of anything.
    stubPages([valuePage({ amounts: ["10.00", "5.00"], amountCurrencies: ["USD", "EUR"] })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("CURRENCY_AMBIGUOUS");
  });

  it("refuses when an order's currency differs from the shop's", async () => {
    stubPages([valuePage({ amounts: ["10.00"], shopCurrency: "USD", amountCurrencies: ["CAD"] })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("CURRENCY_AMBIGUOUS");
  });

  it("refuses when the shop states no currency rather than assuming USD", async () => {
    const page = valuePage({ amounts: ["10.00"] });
    (page.data as { shop: unknown }).shop = {};
    stubPages([page]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("CURRENCY_AMBIGUOUS");
  });

  it("refuses a malformed currency code", async () => {
    stubPages([valuePage({ amounts: ["10.00"], shopCurrency: "dollars" })]);
    expect((await sumValue()).observed).toBe(false);
  });

  it("records a non-USD currency as itself, with the right scale", async () => {
    stubPages([valuePage({ amounts: ["5000", "1200"], currency: "JPY" })]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.currency).toBe("JPY");
    expect(outcome.amountScale).toBe(0);
    expect(outcome.amountMinor).toBe(6200);
    // NOT 620000 — the 100x error a hardcoded "cents" assumption produces.
    expect(formatMinor(outcome.amountMinor, outcome.amountScale, outcome.currency)).toBe("6200 JPY");
  });

  it("records a three-decimal currency without inflating it", async () => {
    stubPages([valuePage({ amounts: ["5.000", "2.500"], currency: "KWD" })]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountScale).toBe(3);
    expect(formatMinor(outcome.amountMinor, outcome.amountScale, outcome.currency)).toBe("7.500 KWD");
  });
});

// ---------------------------------------------------------------------------
// Exactness
// ---------------------------------------------------------------------------

describe("an estimate never becomes an exact economic fact", () => {
  it("refuses an amount that is not an exact decimal", async () => {
    for (const bad of ["1e3", "1,234.00", "12.", "abc", "-5.00"]) {
      stubPages([valuePage({ amounts: [bad] })]);
      const outcome = await sumValue();
      expect(outcome.observed, bad).toBe(false);
      expect(outcome.observed === false && outcome.failure, bad).toBe("IMPRECISE_VALUE");
    }
  });

  it("refuses an unrounded computed figure padded past a currency's places", async () => {
    stubPages([valuePage({ amounts: ["123.456789"] })]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.failure).toBe("IMPRECISE_VALUE");
  });

  it("refuses a numeric (non-string) amount, which would have gone through a float", async () => {
    const page = valuePage({ amounts: ["10.00"] });
    (page.data.orders.edges[0].node.totalPriceSet.shopMoney as { amount: unknown }).amount = 10.0;
    stubPages([page]);
    expect((await sumValue()).observed).toBe(false);
  });

  it("A REAL ZERO-VALUE WINDOW IS A REAL MEASUREMENT", async () => {
    // The store was asked, it holds no orders, and that is a fact — distinct in
    // every way from a failure to ask.
    stubPages([valuePage({ amounts: [], count: 0 })]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(0);
    expect(outcome.orderCount).toBe(0);
    // And it still carries a currency, so "0.00 USD" is a denominated fact.
    expect(outcome.currency).toBe("USD");
  });

  it("an unavailable provider is not a zero-value window", async () => {
    stubPages([{ errors: [{ message: "Throttled" }] }]);
    const outcome = await sumValue();
    expect(outcome.observed).toBe(false);
    expect("amountMinor" in outcome).toBe(false);
  });

  it("inherits every P5-E transport refusal", async () => {
    stubPages([{}], 401);
    expect((await sumValue()).observed).toBe(false);
    stubPages([{}], 429);
    const throttled = await sumValue();
    expect(throttled.observed === false && throttled.failure).toBe("PROVIDER_THROTTLED");
  });

  it("refuses an invalid shop domain before any request", async () => {
    const calls = stubPages([valuePage({ amounts: ["10.00"] })]);
    const outcome = await sumValue({
      scope: "169.254.169.254",
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-08T00:00:00Z"),
    });
    expect(outcome.observed === false && outcome.failure).toBe("SCOPE_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("asks for the order-time total, not the drifting current total", async () => {
    const calls = stubPages([valuePage({ amounts: ["10.00"] })]);
    await sumValue();
    // `current*` money fields are defined by Shopify as "after returns, refunds,
    // order edits and cancellations" — they move, and a measurement built on a
    // moving value can never be re-verified against its own digest.
    expect(calls[0].body).toContain("totalPriceSet");
    expect(calls[0].body).not.toContain("currentTotalPriceSet");
  });

  it("sends the same half-open window filter the count uses", async () => {
    const calls = stubPages([valuePage({ amounts: ["10.00"] })]);
    await sumValue();
    expect(calls[0].body).toContain("created_at:>=");
    expect(calls[0].body).toContain("created_at:<");
    expect(calls[0].body).not.toContain("<=");
  });

  it("digests every page, not just the last", async () => {
    stubPages([
      valuePage({ amounts: ["10.00"], count: 2, hasNextPage: true, endCursor: "c1", idPrefix: "a" }),
      valuePage({ amounts: ["5.00"], count: 2, hasNextPage: false, idPrefix: "b" }),
    ]);
    const first = await sumValue();
    stubPages([
      valuePage({ amounts: ["11.00"], count: 2, hasNextPage: true, endCursor: "c1", idPrefix: "a" }),
      valuePage({ amounts: ["4.00"], count: 2, hasNextPage: false, idPrefix: "b" }),
    ]);
    const second = await sumValue();
    expect(first.observed && second.observed).toBe(true);
    if (!first.observed || !second.observed) return;
    // Same total, different retrieval — the digests must differ.
    expect(first.amountMinor).toBe(second.amountMinor);
    expect(first.responseDigest).not.toBe(second.responseDigest);
  });

  it("never echoes the token", async () => {
    stubPages([{ errors: [{ message: `token ${TOKEN}` }] }]);
    const outcome = await sumValue();
    expect(outcome.observed === false && outcome.detail).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// The gate is the same as the count's
// ---------------------------------------------------------------------------

describe("money goes through exactly the same gate as volume", () => {
  async function connectAndDeclare(owner: User, rule = EXTERNAL_ORDER_VALUE_RULE) {
    globalThis.fetch = realFetch;
    stubPages([{ data: { ordersCount: { count: 0, precision: "EXACT" } } }]);
    await connectShopifyStore({ userId: owner.id, shopDomain: SHOP, accessToken: TOKEN });
    globalThis.fetch = realFetch;

    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: `V ${Math.random().toString(36).slice(2)}` },
    });
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule,
      externalScope: SHOP,
      windowStart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      windowMinutes: 24 * 60,
    });
    return experiment;
  }

  it("reads the declared window when everything checks out", async () => {
    const owner = await createTestUser();
    const experiment = await connectAndDeclare(owner);
    stubPages([valuePage({ amounts: ["25.00", "75.00"] })]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(10000);
  });

  it("refuses when the window was widened after dispatch", async () => {
    const owner = await createTestUser();
    const experiment = await connectAndDeclare(owner);
    await db.experiment.update({
      where: { id: experiment.id },
      data: { observationWindowMinutes: 60 * 24 * 60 },
    });
    const calls = stubPages([valuePage({ amounts: ["9999.00"] })]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("CONTRACT_ALTERED");
    expect(calls).toHaveLength(0);
  });

  it("refuses a window that has not closed", async () => {
    const owner = await createTestUser();
    globalThis.fetch = realFetch;
    stubPages([{ data: { ordersCount: { count: 0, precision: "EXACT" } } }]);
    await connectShopifyStore({ userId: owner.id, shopDomain: SHOP, accessToken: TOKEN });
    globalThis.fetch = realFetch;
    const experiment = await db.experiment.create({ data: { userId: owner.id, hypothesis: "open" } });
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: new Date(),
      windowMinutes: 7 * 24 * 60,
    });
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("WINDOW_NOT_CLOSED");
  });

  it("refuses when no store is connected", async () => {
    const stranger = await createTestUser();
    const experiment = await db.experiment.create({ data: { userId: stranger.id, hypothesis: "none" } });
    await declareObservationContract({
      userId: stranger.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      windowMinutes: 24 * 60,
    });
    const outcome = await observeDeclaredOrderValue(stranger.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("NOT_CONFIGURED");
  });

  it("refuses an experiment that declared the COUNT rule instead", async () => {
    const owner = await createTestUser();
    const experiment = await connectAndDeclare(owner, "EXTERNAL_ORDER_COUNT");
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("NO_CONTRACT");
  });
});

// ---------------------------------------------------------------------------
// The rule, the digest, the measurement
// ---------------------------------------------------------------------------

describe("a monetary measurement carries its scale and currency or it is not written", () => {
  const rule = OBSERVATION_RULES.EXTERNAL_ORDER_VALUE;

  function goodOutput(overrides: Record<string, unknown> = {}) {
    return {
      observed: true,
      amountMinor: 10000,
      amountScale: 2,
      currency: "USD",
      orderCount: 2,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: "2026-01-09T00:00:00.000Z",
      responseDigest: "abc",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-08T00:00:00.000Z",
      semantics: "DELTA_OVER_WINDOW",
      ...overrides,
    };
  }

  it("is frozen", () => {
    expect(() => {
      (rule as unknown as { unit: string }).unit = "profit";
    }).toThrow();
  });

  it("states that it is not revenue, not profit, not attribution, not causation", () => {
    expect(rule.doesNotEstablish).toMatch(/not revenue/i);
    expect(rule.doesNotEstablish).toMatch(/not profit/i);
    expect(rule.doesNotEstablish).toMatch(/not attribution/i);
    expect(rule.doesNotEstablish).toMatch(/not causation/i);
  });

  it("does not call the figure revenue in its own unit", () => {
    expect(rule.unit.toLowerCase()).not.toContain("revenue");
    expect(rule.unit.toLowerCase()).not.toContain("profit");
  });

  it("keeps observedValue meaning the ORDER COUNT, not the amount", () => {
    const outcome = rule.observe(goodOutput());
    expect(outcome && "observedValue" in outcome && outcome.observedValue).toBe(2);
    expect(outcome && "money" in outcome && outcome.money?.amountMinor).toBe(10000);
  });

  it("refuses an output missing any one of amount, scale or currency", () => {
    for (const key of ["amountMinor", "amountScale", "currency"]) {
      const partial = goodOutput();
      delete (partial as Record<string, unknown>)[key];
      expect(rule.observe(partial), key).toBeNull();
    }
  });

  it("refuses a malformed currency rather than recording an undenominated amount", () => {
    for (const bad of ["usd", "DOLLARS", "", "US"]) {
      expect(rule.observe(goodOutput({ currency: bad })), bad).toBeNull();
    }
  });

  it("refuses a fractional or negative amount", () => {
    expect(rule.observe(goodOutput({ amountMinor: 10.5 }))).toBeNull();
    expect(rule.observe(goodOutput({ amountMinor: -1 }))).toBeNull();
  });

  it("refuses a scale past any real currency", () => {
    expect(rule.observe(goodOutput({ amountScale: 9 }))).toBeNull();
  });

  it("refuses a LEVEL_AT_INSTANT answer", () => {
    expect(rule.observe(goodOutput({ semantics: "LEVEL_AT_INSTANT" }))).toBeNull();
  });

  it("reads a refusal as a non-answer with no amount", () => {
    const outcome = rule.observe({ observed: false, failure: "INCOMPLETE_RESULT", detail: "partial" });
    expect(outcome && "notObserved" in outcome).toBe(true);
    expect(outcome && "money" in outcome).toBe(false);
  });

  it("binds amount, scale AND currency into the digest", () => {
    const base = {
      experimentId: "e1",
      source: "EXTERNAL_OBSERVED",
      agentRunId: "r1",
      agentStepId: "s1",
      rule: "EXTERNAL_ORDER_VALUE",
      unit: "total price",
      observedValue: 2,
      observedTotal: 2,
      provenance: "shopify: shop",
      money: { amountMinor: 10000, amountScale: 2, currency: "USD" },
    };
    const original = measurementDigest(base);
    // Each of these is a different economic claim and must hash differently.
    expect(measurementDigest({ ...base, money: { ...base.money, amountMinor: 20000 } })).not.toBe(original);
    // 1250 at scale 2 and at scale 1 are 12.50 and 125.0.
    expect(measurementDigest({ ...base, money: { ...base.money, amountScale: 1 } })).not.toBe(original);
    // Relabelling USD as JPY is a ~150x revaluation of the same integer.
    expect(measurementDigest({ ...base, money: { ...base.money, currency: "JPY" } })).not.toBe(original);
  });

  it("leaves a count measurement's digest exactly as it was before P5-F", () => {
    // The money terms are APPENDED, so a measurement with no amount hashes to
    // the same value it did when only P5-D and P5-E existed. Otherwise shipping
    // this phase would report every existing row as tampered with.
    const countOnly = {
      experimentId: "e1",
      source: "MACHINE_OBSERVED",
      agentRunId: "r1",
      agentStepId: "s1",
      rule: "RESEARCH_SOURCED_RESULTS",
      unit: "results",
      observedValue: 3,
      observedTotal: 5,
      provenance: "research provider: mock",
    };
    expect(measurementDigest(countOnly)).toBe(measurementDigest({ ...countOnly, money: null }));
  });
});

// ---------------------------------------------------------------------------
// End to end, through the real evidence loop
// ---------------------------------------------------------------------------

describe("a monetary measurement lands with full provenance, or not at all", () => {
  async function seedExecutedValueExperiment(owner: User, output: unknown) {
    globalThis.fetch = realFetch;
    stubPages([{ data: { ordersCount: { count: 0, precision: "EXACT" } } }]);
    await connectShopifyStore({ userId: owner.id, shopDomain: SHOP, accessToken: TOKEN });
    globalThis.fetch = realFetch;

    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: `E2E ${Math.random().toString(36).slice(2)}` },
    });
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      windowMinutes: 24 * 60,
    });

    const run = await db.agentRun.create({
      data: { userId: owner.id, objective: "observe value", status: "COMPLETED" },
    });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "observe value",
        toolName: "economic.observe_order_value",
        status: "COMPLETED",
        output: JSON.stringify(output),
      },
    });
    await db.experiment.update({ where: { id: experiment.id }, data: { executionRunId: run.id } });
    return experiment;
  }

  it("persists the amount, the scale and the currency together", async () => {
    const owner = await createTestUser();
    const experiment = await seedExecutedValueExperiment(owner, {
      observed: true,
      amountMinor: 24999,
      amountScale: 2,
      currency: "USD",
      orderCount: 3,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: new Date().toISOString(),
      responseDigest: "digest-1",
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      semantics: "DELTA_OVER_WINDOW",
    });

    const result = await observeExperimentExecution(owner.id, experiment.id);
    expect(result.observed).toBe(true);
    if (!result.observed) return;
    expect(result.measurement.observedAmountMinor).toBe(24999);
    expect(result.measurement.observedAmountScale).toBe(2);
    expect(result.measurement.observedCurrency).toBe("USD");
    // The count column still means orders summed.
    expect(result.measurement.observedValue).toBe(3);
    expect(result.measurement.source).toBe("EXTERNAL_OBSERVED");
  });

  it("renders the amount with its currency and never with an assumed symbol", async () => {
    const owner = await createTestUser();
    const experiment = await seedExecutedValueExperiment(owner, {
      observed: true,
      amountMinor: 6200,
      amountScale: 0,
      currency: "JPY",
      orderCount: 2,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: new Date().toISOString(),
      responseDigest: "digest-jpy",
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      semantics: "DELTA_OVER_WINDOW",
    });
    await observeExperimentExecution(owner.id, experiment.id);

    const evidence = await getExperimentEvidence(owner.id, experiment.id);
    expect(evidence?.measurement?.money?.formatted).toBe("6200 JPY");
    expect(evidence?.measurement?.money?.formatted).not.toContain("$");
    // And the caveat travels with it.
    expect(evidence?.ruleDoesNotEstablish).toMatch(/not revenue/i);
  });

  it("writes NO measurement when the sum was refused", async () => {
    const owner = await createTestUser();
    const experiment = await seedExecutedValueExperiment(owner, {
      observed: false,
      failure: "INCOMPLETE_RESULT",
      detail: "only 2 of 10 orders could be read",
      provider: "shopify",
      attemptedAt: new Date().toISOString(),
    });

    const result = await observeExperimentExecution(owner.id, experiment.id);
    expect(result.observed).toBe(false);
    expect(result.observed === false && result.failure).toBe("INCOMPLETE_RESULT");
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
    // The diagnostic is recorded so a surface can say "unavailable" rather than
    // rendering a silence that reads as 0.00.
    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.lastObservationFailure).toBe("INCOMPLETE_RESULT");
  });

  it("a count measurement projects money as null, not as zero", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "count only", observationRule: "RESEARCH_SOURCED_RESULTS" },
    });
    await db.experimentMeasurement.create({
      data: {
        userId: owner.id,
        experimentId: experiment.id,
        source: "MACHINE_OBSERVED",
        observedValue: 3,
        observedTotal: 5,
        unit: "results",
        rule: "RESEARCH_SOURCED_RESULTS",
        provenance: "research provider: mock",
        digest: "d",
      },
    });
    const evidence = await getExperimentEvidence(owner.id, experiment.id);
    expect(evidence?.measurement?.money).toBeNull();
  });

  it("projects a HALF-RECORDED amount as no amount, never with an assumed currency", async () => {
    // Found by a revert proof that did not fail: nothing was covering the
    // all-or-nothing rule in `projectMeasurement`, so a version that filled in
    // `?? "USD"` and `?? 2` for the missing halves passed the whole suite.
    //
    // That fallback is exactly the bug this phase exists to prevent — an integer
    // with someone's assumed denomination attached, rendered as though the store
    // had said it.
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "half money", observationRule: EXTERNAL_ORDER_VALUE_RULE },
    });
    await db.experimentMeasurement.create({
      data: {
        userId: owner.id,
        experimentId: experiment.id,
        source: "EXTERNAL_OBSERVED",
        observedValue: 1,
        observedTotal: 1,
        unit: "total price",
        rule: EXTERNAL_ORDER_VALUE_RULE,
        provenance: "shopify: shop",
        digest: "d",
        // An amount with no currency and no scale. Not money.
        observedAmountMinor: 12345,
        observedAmountScale: null,
        observedCurrency: null,
      },
    });

    const evidence = await getExperimentEvidence(owner.id, experiment.id);
    expect(evidence?.measurement?.money).toBeNull();
  });

  it("projects an amount with a currency but no scale as no amount", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "no scale", observationRule: EXTERNAL_ORDER_VALUE_RULE },
    });
    await db.experimentMeasurement.create({
      data: {
        userId: owner.id,
        experimentId: experiment.id,
        source: "EXTERNAL_OBSERVED",
        observedValue: 1,
        observedTotal: 1,
        unit: "total price",
        rule: EXTERNAL_ORDER_VALUE_RULE,
        provenance: "shopify: shop",
        digest: "d",
        observedAmountMinor: 12345,
        observedAmountScale: null,
        observedCurrency: "USD",
      },
    });
    // 12345 could be 123.45 or 12345 or 12.345. Without the scale there is no
    // amount to show, only an integer.
    expect((await getExperimentEvidence(owner.id, experiment.id))?.measurement?.money).toBeNull();
  });

  it("detects a monetary measurement whose currency was relabelled", async () => {
    const owner = await createTestUser();
    const experiment = await seedExecutedValueExperiment(owner, {
      observed: true,
      amountMinor: 10000,
      amountScale: 2,
      currency: "USD",
      orderCount: 1,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: new Date().toISOString(),
      responseDigest: "digest-2",
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      semantics: "DELTA_OVER_WINDOW",
    });
    const observed = await observeExperimentExecution(owner.id, experiment.id);
    expect(observed.observed).toBe(true);
    if (!observed.observed) return;

    expect((await verifyEvidenceIntegrity(owner.id)).filter((i) => i.experimentId === experiment.id)).toHaveLength(0);

    // The attack: same integer, different currency. 100.00 USD becomes 100 JPY
    // — or, run the other way, a trivial sum becomes a large one.
    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { observedCurrency: "JPY" },
    });

    const issues = await verifyEvidenceIntegrity(owner.id);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ finding: "MEASUREMENT_DIGEST_MISMATCH", experimentId: experiment.id }),
      ])
    );
  });

  it("detects a monetary measurement whose scale was shifted", async () => {
    const owner = await createTestUser();
    const experiment = await seedExecutedValueExperiment(owner, {
      observed: true,
      amountMinor: 125000,
      amountScale: 2,
      currency: "USD",
      orderCount: 1,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: new Date().toISOString(),
      responseDigest: "digest-3",
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      semantics: "DELTA_OVER_WINDOW",
    });
    const observed = await observeExperimentExecution(owner.id, experiment.id);
    if (!observed.observed) return;

    // 1250.00 becomes 125000.0 — a 100x inflation from one column.
    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { observedAmountScale: 1 },
    });
    const issues = await verifyEvidenceIntegrity(owner.id);
    expect(issues.some((i) => i.experimentId === experiment.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Classification and source-level guarantees
// ---------------------------------------------------------------------------

describe("reading an amount is still only a read", () => {
  it("classifies identically to the count", () => {
    const value = classifyAction("tool", "economic.observe_order_value").classification;
    const count = classifyAction("tool", "economic.observe_orders").classification;
    expect(value).toEqual(count);
    expect(value.effect).toBe("READ");
    // Summing order totals spends nothing and commits nothing. `financial` means
    // "moves or commits money", not "concerns money".
    expect(value.financial).toBe(false);
  });

  it("adds no money-moving action to either registry", () => {
    // The P4-A tripwire, restated here so P5-F is covered by it too.
    const { classification } = classifyAction("tool", "economic.observe_order_value");
    expect(classification.financial && classification.reversibility === "IRREVERSIBLE").toBe(false);
  });
});

describe("the value read cannot write anything", () => {
  const source = readFileSync("src/lib/integrations/shopify.ts", "utf8");
  const decimalSource = readFileSync("src/lib/integrations/decimal.ts", "utf8");

  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("contains no GraphQL mutation in any query literal", () => {
    for (const literal of source.match(/`[^`]*`/g) ?? []) {
      expect(literal.toLowerCase()).not.toMatch(/\bmutation\s+\w+/);
    }
  });

  it("uses the stable order-time total, not the drifting current total", () => {
    expect(codeOnly(source)).toContain("totalPriceSet");
    expect(codeOnly(source)).not.toContain("currentTotalPriceSet");
  });

  it("the decimal module is a pure leaf with no imports at all", () => {
    expect(codeOnly(decimalSource)).not.toMatch(/^import /m);
    expect(codeOnly(decimalSource)).not.toContain("@/lib/db");
    expect(codeOnly(decimalSource)).not.toContain("fetch");
  });

  it("never converts a money string through a float", () => {
    const code = codeOnly(decimalSource);
    for (const forbidden of ["parseFloat", "Number(raw", "toFixed", "Math.round"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("the value outcome's failure arm carries no amount field", () => {
    const portSource = readFileSync("src/lib/integrations/economic.ts", "utf8");
    const refusal = portSource.slice(
      portSource.indexOf("interface ObservationRefusal"),
      portSource.indexOf("export type ObservationOutcome")
    );
    for (const field of ["amountMinor", "amountScale", "currency"]) {
      expect(refusal).not.toContain(field);
    }
  });
});
