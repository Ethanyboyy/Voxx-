/**
 * [P5-E] FIRST REAL EXTERNAL ECONOMIC MEASUREMENT — adversarial tests.
 *
 * NO MOCK PROVIDER EXISTS IN `src/`. These tests stub `globalThis.fetch` and
 * nothing else, so the code under test is the real `ShopifyOrderCountProvider`
 * parsing real-shaped Shopify responses. A mock provider living in the source
 * tree would be a second implementation that could drift from the real one, and
 * the tests would then be proving the mock's behaviour.
 *
 * The attacks are, in order: get a number out of a failure; get a number for a
 * window nobody declared; get a number from a store nobody connected; get a
 * number from someone else's store; change the question after the answer.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import { grantPermission } from "@/lib/permissions/service";
import { encryptField } from "@/lib/security/crypto";
import {
  buildWindowFilter,
  isValidShopDomain,
  ShopifyOrderCountProvider,
  SHOPIFY_API_VERSION,
  SHOPIFY_REQUIRED_SCOPE,
} from "@/lib/integrations/shopify";
import { resolveConnectionCredential, responseDigestOf } from "@/lib/integrations/economic";
import {
  classifyWindowTiming,
  observationContractDigestOf,
  resolveObservationWindow,
  EXTERNAL_OBSERVATION_GRACE_MINUTES,
} from "@/lib/economic/observationContract";
import {
  declareObservationContract,
  observeDeclaredOrderWindow,
  EXTERNAL_ORDER_COUNT_RULE,
} from "@/lib/economic/externalObservation";
import { connectShopifyStore } from "@/lib/connections/shopify";
import { OBSERVATION_RULES, observeExperimentExecution } from "@/lib/economic/evidence";
import { classifyAction } from "@/lib/policy/classification";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

let user: User;
let other: User;

const SHOP = "vox-test-store.myshopify.com";
const TOKEN = "shpat_testtoken0123456789";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

/** Replies with a real-shaped Shopify GraphQL body. */
function stubFetch(body: unknown, init: { status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, requestInit: RequestInit) => {
    calls.push({ url: String(url), init: requestInit });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function okCount(count: number, precision = "EXACT") {
  return { data: { ordersCount: { count, precision } } };
}

beforeAll(async () => {
  user = await createTestUser();
  other = await createTestUser();
});

/** A store connected the real way: a genuine verification call it passes. */
async function connectStore(owner: User, shop = SHOP) {
  stubFetch(okCount(0));
  const result = await connectShopifyStore({ userId: owner.id, shopDomain: shop, accessToken: TOKEN });
  globalThis.fetch = realFetch;
  return result;
}

/** A closed window: started two days ago, one day long. */
function closedWindow() {
  const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  return { start, minutes: 24 * 60 };
}

async function makeDeclaredExperiment(owner: User, overrides: Record<string, unknown> = {}) {
  const experiment = await db.experiment.create({
    data: { userId: owner.id, hypothesis: `H ${Math.random().toString(36).slice(2)}` },
  });
  const window = closedWindow();
  await declareObservationContract({
    userId: owner.id,
    experimentId: experiment.id,
    rule: EXTERNAL_ORDER_COUNT_RULE,
    externalScope: SHOP,
    windowStart: window.start,
    windowMinutes: window.minutes,
    ...overrides,
  });
  return experiment;
}

// ---------------------------------------------------------------------------
// The SSRF boundary
// ---------------------------------------------------------------------------

describe("the provider talks only to a real Shopify shop domain", () => {
  it("accepts a well-formed myshopify domain", () => {
    expect(isValidShopDomain("acme.myshopify.com")).toBe(true);
    expect(isValidShopDomain("a1-b2.myshopify.com")).toBe(true);
  });

  it("rejects every shape that would redirect the authenticated request", () => {
    const attacks = [
      "evil.test",
      "acme.myshopify.com.evil.test",
      "acme.myshopify.com:8080",
      "http://acme.myshopify.com",
      "https://acme.myshopify.com",
      "acme.myshopify.com/admin",
      "169.254.169.254",
      "localhost",
      "acme.myshopify.com#@evil.test",
      "acme.myshopify.com@evil.test",
      "-acme.myshopify.com",
      "acme-.myshopify.com",
      "ACME.MYSHOPIFY.COM",
      "acme.myshopify.com ",
      "",
      "..myshopify.com",
    ];
    for (const attack of attacks) {
      expect(isValidShopDomain(attack), attack).toBe(false);
    }
  });

  it("makes no request at all for an invalid scope", async () => {
    const calls = stubFetch(okCount(5));
    const provider = new ShopifyOrderCountProvider();
    const outcome = await provider.countOrdersInWindow({
      scope: "169.254.169.254",
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("SCOPE_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("builds the URL from fixed literals plus the validated domain", async () => {
    const calls = stubFetch(okCount(2));
    await new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
    expect(calls[0].url).toBe(`https://${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
  });

  it("pins the API version rather than tracking latest", () => {
    expect(SHOPIFY_API_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// The HTTP-200 error — the central hazard
// ---------------------------------------------------------------------------

describe("no code path turns a failure into a number", () => {
  async function observe(body: unknown, status = 200) {
    stubFetch(body, { status });
    return new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
  }

  it("refuses an errors[] body that arrived with HTTP 200", async () => {
    // The whole reason this provider is written the way it is.
    const outcome = await observe({
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
    });
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("PROVIDER_THROTTLED");
    // And there is no value field to fall back on.
    expect("value" in outcome).toBe(false);
  });

  it("refuses an access-denied errors[] body with HTTP 200", async () => {
    const outcome = await observe({
      errors: [{ message: "Access denied for ordersCount field. Required access: read_orders" }],
    });
    expect(outcome.observed === false && outcome.failure).toBe("PROVIDER_REJECTED");
  });

  it("refuses a 200 whose data is null — not a zero", async () => {
    const outcome = await observe({ data: null });
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("PROVIDER_UNAVAILABLE");
  });

  it("refuses a 200 whose ordersCount is null", async () => {
    const outcome = await observe({ data: { ordersCount: null } });
    expect(outcome.observed).toBe(false);
  });

  it("refuses an AT_LEAST count — a lower bound is not a measurement", async () => {
    const outcome = await observe(okCount(1000, "AT_LEAST"));
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("IMPRECISE_RESULT");
  });

  it("refuses a non-integer or negative count", async () => {
    for (const bad of [1.5, -1, "3", null]) {
      const outcome = await observe(okCount(bad as number));
      expect(outcome.observed, String(bad)).toBe(false);
    }
  });

  it("refuses unparseable JSON", async () => {
    const outcome = await observe("<html>502 Bad Gateway</html>");
    expect(outcome.observed === false && outcome.failure).toBe("PROVIDER_UNAVAILABLE");
  });

  it("distinguishes 401, 429 and 500", async () => {
    expect((await observe({}, 401)).observed === false).toBe(true);
    const unauthorized = await observe({}, 401);
    expect(unauthorized.observed === false && unauthorized.failure).toBe("PROVIDER_REJECTED");
    const throttled = await observe({}, 429);
    expect(throttled.observed === false && throttled.failure).toBe("PROVIDER_THROTTLED");
    const broken = await observe({}, 500);
    expect(broken.observed === false && broken.failure).toBe("PROVIDER_UNAVAILABLE");
  });

  it("refuses a network failure without leaking the URL", async () => {
    globalThis.fetch = (async () => {
      throw new Error(`getaddrinfo ENOTFOUND https://${SHOP}/admin/api/x/graphql.json`);
    }) as unknown as typeof fetch;
    const outcome = await new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.detail).not.toContain("graphql.json");
  });

  it("A REAL ZERO IS A REAL MEASUREMENT, and is not the same as a failure", async () => {
    const outcome = await observe(okCount(0));
    expect(outcome.observed).toBe(true);
    expect(outcome.observed && outcome.value).toBe(0);
    // OBSERVED ZERO and UNAVAILABLE must never collapse. This is the pair.
    const failed = await observe({ errors: [{ message: "Throttled" }] });
    expect(failed.observed).toBe(false);
  });

  it("never echoes the access token in any refusal detail", async () => {
    for (const body of [{ errors: [{ message: `token ${TOKEN} denied` }] }, "boom"]) {
      const outcome = await observe(body);
      expect(outcome.observed === false && outcome.detail).not.toContain(TOKEN);
    }
  });

  it("sends the token in the header and never in the URL or body", async () => {
    const calls = stubFetch(okCount(1));
    await new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe(TOKEN);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(String(calls[0].init.body)).not.toContain(TOKEN);
  });

  it("digests the response rather than storing it", async () => {
    const raw = JSON.stringify(okCount(4));
    stubFetch(raw);
    const outcome = await new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-01-02T00:00:00Z"),
    });
    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.responseDigest).toBe(responseDigestOf(raw));
    expect(outcome.responseDigest).not.toContain("ordersCount");
  });
});

// ---------------------------------------------------------------------------
// Window semantics
// ---------------------------------------------------------------------------

describe("the window is half-open and cannot double-count", () => {
  it("filters with >= on the start and < on the end", () => {
    const filter = buildWindowFilter(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-08T00:00:00Z"));
    expect(filter).toContain("created_at:>='2026-01-01T00:00:00.000Z'");
    expect(filter).toContain("created_at:<'2026-01-08T00:00:00.000Z'");
    // An inclusive upper bound is what makes two adjacent windows both claim the
    // order that landed on the boundary.
    expect(filter).not.toContain("<=");
  });

  it("always sends an explicit UTC instant, never a bare date", () => {
    const filter = buildWindowFilter(new Date("2026-03-01T00:00:00Z"), new Date("2026-03-02T00:00:00Z"));
    expect(filter.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g)).toHaveLength(2);
  });

  it("refuses a window with no duration", async () => {
    stubFetch(okCount(5));
    const instant = new Date("2026-01-01T00:00:00Z");
    const outcome = await new ShopifyOrderCountProvider().countOrdersInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: instant,
      windowEnd: instant,
    });
    expect(outcome.observed).toBe(false);
  });

  it("returns null for an undeclared or out-of-range window", () => {
    expect(resolveObservationWindow({ observationWindowStart: null, observationWindowMinutes: 60 })).toBeNull();
    expect(
      resolveObservationWindow({ observationWindowStart: new Date(), observationWindowMinutes: null })
    ).toBeNull();
    expect(
      resolveObservationWindow({ observationWindowStart: new Date(), observationWindowMinutes: 0 })
    ).toBeNull();
    expect(
      resolveObservationWindow({ observationWindowStart: new Date(), observationWindowMinutes: 10_000_000 })
    ).toBeNull();
  });

  it("classifies an open window as not closed", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const window = { start, end: new Date("2026-01-08T00:00:00Z"), minutes: 7 * 24 * 60 };
    expect(classifyWindowTiming(window, new Date("2026-01-04T00:00:00Z"))).toBe("WINDOW_NOT_CLOSED");
    expect(classifyWindowTiming(window, new Date("2026-01-08T00:00:00Z"))).toBe("ELIGIBLE");
    expect(classifyWindowTiming(window, new Date("2026-01-10T00:00:00Z"))).toBe("ELIGIBLE");
  });

  it("expires a window once the store's record has had time to move", () => {
    const window = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-02T00:00:00Z"), minutes: 1440 };
    const wellPast = new Date(window.end.getTime() + (EXTERNAL_OBSERVATION_GRACE_MINUTES + 1) * 60_000);
    expect(classifyWindowTiming(window, wellPast)).toBe("WINDOW_EXPIRED");
  });
});

// ---------------------------------------------------------------------------
// The contract freeze
// ---------------------------------------------------------------------------

describe("the question is frozen before the answer is visible", () => {
  it("hashes rule, scope, start and length together", () => {
    const terms = {
      rule: EXTERNAL_ORDER_COUNT_RULE,
      scope: SHOP,
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowMinutes: 1440,
    };
    const original = observationContractDigestOf(terms);
    expect(observationContractDigestOf(terms)).toBe(original);
    for (const mutation of [
      { rule: "SOMETHING_ELSE" },
      { scope: "other.myshopify.com" },
      { windowStart: new Date("2026-01-02T00:00:00Z") },
      { windowMinutes: 2880 },
    ]) {
      expect(observationContractDigestOf({ ...terms, ...mutation })).not.toBe(original);
    }
  });

  it("carries no secret, so it is safe in an event payload", () => {
    const digest = observationContractDigestOf({
      rule: EXTERNAL_ORDER_COUNT_RULE,
      scope: SHOP,
      windowStart: new Date(),
      windowMinutes: 60,
    });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to declare a contract after the experiment was dispatched", async () => {
    const experiment = await db.experiment.create({
      data: { userId: user.id, hypothesis: "already run", executionRunId: `run-${Math.random()}` },
    });
    const window = closedWindow();
    expect(
      await declareObservationContract({
        userId: user.id,
        experimentId: experiment.id,
        rule: EXTERNAL_ORDER_COUNT_RULE,
        externalScope: SHOP,
        windowStart: window.start,
        windowMinutes: window.minutes,
      })
    ).toEqual({ declared: false, reason: "ALREADY_DISPATCHED" });
  });

  it("refuses to ask when the window was widened after dispatch", async () => {
    await connectStore(user);
    const experiment = await makeDeclaredExperiment(user);

    // The attack: a disappointing week, so widen the window to include a better
    // one. The store would answer truthfully; the question is what changed.
    await db.experiment.update({
      where: { id: experiment.id },
      data: { observationWindowMinutes: 30 * 24 * 60 },
    });

    const calls = stubFetch(okCount(500));
    const outcome = await observeDeclaredOrderWindow(user.id, experiment.id);
    expect(outcome.observed).toBe(false);
    expect(outcome.observed === false && outcome.failure).toBe("CONTRACT_ALTERED");
    // The store was never even asked.
    expect(calls).toHaveLength(0);
  });

  it("refuses to ask when the store was repointed after dispatch", async () => {
    await connectStore(user);
    const experiment = await makeDeclaredExperiment(user);
    await db.experiment.update({
      where: { id: experiment.id },
      data: { externalScope: "better-store.myshopify.com" },
    });
    const outcome = await observeDeclaredOrderWindow(user.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("CONTRACT_ALTERED");
  });

  it("refuses an experiment that declares no contract", async () => {
    await connectStore(user);
    const bare = await db.experiment.create({
      data: { userId: user.id, hypothesis: "no contract", observationRule: EXTERNAL_ORDER_COUNT_RULE },
    });
    const outcome = await observeDeclaredOrderWindow(user.id, bare.id);
    expect(outcome.observed === false && outcome.failure).toBe("NO_CONTRACT");
  });

  it("refuses an experiment that declared a different rule", async () => {
    await connectStore(user);
    const experiment = await makeDeclaredExperiment(user);
    await db.experiment.update({
      where: { id: experiment.id },
      data: { observationRule: "RESEARCH_SOURCED_RESULTS" },
    });
    const outcome = await observeDeclaredOrderWindow(user.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("NO_CONTRACT");
  });

  it("refuses a window that has not closed", async () => {
    await connectStore(user);
    const experiment = await db.experiment.create({
      data: { userId: user.id, hypothesis: "still running" },
    });
    // Starts now, runs a week. Asking now would count a partial period, low.
    await declareObservationContract({
      userId: user.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_COUNT_RULE,
      externalScope: SHOP,
      windowStart: new Date(),
      windowMinutes: 7 * 24 * 60,
    });
    const calls = stubFetch(okCount(3));
    const outcome = await observeDeclaredOrderWindow(user.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("WINDOW_NOT_CLOSED");
    expect(calls).toHaveLength(0);
  });

  it("refuses a window that closed too long ago", async () => {
    await connectStore(user);
    const experiment = await db.experiment.create({ data: { userId: user.id, hypothesis: "ancient" } });
    const start = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await declareObservationContract({
      userId: user.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_COUNT_RULE,
      externalScope: SHOP,
      windowStart: start,
      windowMinutes: 24 * 60,
    });
    const outcome = await observeDeclaredOrderWindow(user.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("WINDOW_EXPIRED");
  });
});

// ---------------------------------------------------------------------------
// The tenant boundary and credentials
// ---------------------------------------------------------------------------

describe("one user's experiment can never read another user's store", () => {
  it("refuses when nothing is connected", async () => {
    const stranger = await createTestUser();
    const experiment = await makeDeclaredExperiment(stranger);
    const outcome = await observeDeclaredOrderWindow(stranger.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("NOT_CONFIGURED");
  });

  it("does not resolve a credential across users", async () => {
    await connectStore(other);
    const resolution = await resolveConnectionCredential(user.id, "SHOPIFY");
    // `user` may or may not have their own store from an earlier test; what must
    // never happen is resolving `other`'s.
    if (resolution.resolved) {
      const ownConnection = await db.connection.findFirst({
        where: { userId: user.id, service: "SHOPIFY" },
      });
      expect(ownConnection).not.toBeNull();
    }
    const strangerResolution = await resolveConnectionCredential(
      (await createTestUser()).id,
      "SHOPIFY"
    );
    expect(strangerResolution.resolved).toBe(false);
  });

  it("refuses a PAUSED or REVOKED connection rather than reading it", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    for (const status of ["PAUSED", "REVOKED", "ERROR"] as const) {
      await db.connection.updateMany({ where: { userId: owner.id, service: "SHOPIFY" }, data: { status } });
      const resolution = await resolveConnectionCredential(owner.id, "SHOPIFY");
      expect(resolution.resolved, status).toBe(false);
      expect(resolution.resolved === false && resolution.failure).toBe("NOT_CONFIGURED");
    }
  });

  it("refuses when read access has been revoked even though the row is CONNECTED", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    await db.connection.updateMany({
      where: { userId: owner.id, service: "SHOPIFY" },
      data: { readEnabled: false },
    });
    const resolution = await resolveConnectionCredential(owner.id, "SHOPIFY");
    expect(resolution.resolved === false && resolution.failure).toBe("NOT_AUTHORIZED");
  });

  it("refuses a credential that will not decrypt, without describing why", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    const connection = await db.connection.findFirst({ where: { userId: owner.id, service: "SHOPIFY" } });
    await db.connectionCredential.update({
      where: { connectionId: connection!.id },
      data: { encryptedPayload: encryptField("not json at all") },
    });
    const resolution = await resolveConnectionCredential(owner.id, "SHOPIFY");
    expect(resolution.resolved === false && resolution.failure).toBe("CREDENTIAL_INVALID");
  });

  it("refuses when the connected store is not the declared store", async () => {
    const owner = await createTestUser();
    await connectStore(owner, "actual-store.myshopify.com");
    const experiment = await db.experiment.create({ data: { userId: owner.id, hypothesis: "mismatch" } });
    const window = closedWindow();
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_COUNT_RULE,
      externalScope: "declared-store.myshopify.com",
      windowStart: window.start,
      windowMinutes: window.minutes,
    });
    const calls = stubFetch(okCount(99));
    const outcome = await observeDeclaredOrderWindow(owner.id, experiment.id);
    expect(outcome.observed === false && outcome.failure).toBe("CONTRACT_ALTERED");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

describe("a connection is only CONNECTED when the store actually answered", () => {
  it("performs a real authenticated read before storing anything", async () => {
    const owner = await createTestUser();
    const calls = stubFetch(okCount(0));
    const result = await connectShopifyStore({
      userId: owner.id,
      shopDomain: SHOP,
      accessToken: TOKEN,
    });
    globalThis.fetch = realFetch;
    expect(result.connected).toBe(true);
    // The verification call really happened.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(SHOP);
  });

  it("stores nothing and reaches ERROR when the store rejects the token", async () => {
    const owner = await createTestUser();
    stubFetch({ errors: [{ message: "Access denied" }] });
    const result = await connectShopifyStore({ userId: owner.id, shopDomain: SHOP, accessToken: TOKEN });
    globalThis.fetch = realFetch;

    expect(result.connected).toBe(false);
    const connection = await db.connection.findFirst({
      where: { userId: owner.id, service: "SHOPIFY" },
      include: { credential: true },
    });
    expect(connection?.status).toBe("ERROR");
    // A credential that does not work is not stored.
    expect(connection?.credential).toBeNull();
  });

  it("grants the read capability through the real permission service", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    const permission = await db.permission.findFirst({
      where: { userId: owner.id, capability: "integration.shopify.read" },
    });
    expect(permission?.level).toBe("RECOMMEND");
  });

  it("connects with write access OFF, and connecting never turns it on", async () => {
    // ---- NARROWED IN P5-G, AND HERE IS WHY -------------------------------
    //
    // This asserted `writeCapability === null` — Shopify has no write mode at
    // all. P5-G adds exactly one write, so the capability now exists and this
    // failed, correctly: a write capability appearing on this integration is
    // precisely the kind of change that must never pass unnoticed.
    //
    // But "the capability does not exist" was the implementation, not the
    // invariant. The invariant is that CONNECTING A STORE DOES NOT GRANT WRITE
    // ACCESS — which is what actually protects a merchant, and which still
    // holds. It is asserted directly now, including the negative that no ACT
    // permission is created by connecting.
    const owner = await createTestUser();
    await connectStore(owner);
    const connection = await db.connection.findFirst({ where: { userId: owner.id, service: "SHOPIFY" } });

    expect(connection?.writeEnabled).toBe(false);
    // The capability exists as a mode that is off, not as a mode that is absent.
    expect(connection?.writeCapability).toBe("integration.shopify.write");

    // And nothing granted it. Connecting grants read at RECOMMEND and that is all.
    const write = await db.permission.findFirst({
      where: { userId: owner.id, capability: "integration.shopify.write" },
    });
    expect(write).toBeNull();
  });

  it("refuses an invalid domain before touching the database or the network", async () => {
    const owner = await createTestUser();
    const calls = stubFetch(okCount(0));
    const result = await connectShopifyStore({
      userId: owner.id,
      shopDomain: "http://evil.test",
      accessToken: TOKEN,
    });
    globalThis.fetch = realFetch;
    expect(result.connected).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await db.connection.findFirst({ where: { userId: owner.id, service: "SHOPIFY" } })).toBeNull();
  });

  it("refuses to silently repoint an already-connected store", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    const second = await connectStore(owner, "different.myshopify.com");
    expect(second.connected).toBe(false);
    expect(second.connected === false && second.reason).toBe("ALREADY_CONNECTED");
    const connection = await db.connection.findFirst({ where: { userId: owner.id, service: "SHOPIFY" } });
    expect(connection?.config).toContain(SHOP);
  });

  it("stores the shop domain in the clear and the token only encrypted", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    const connection = await db.connection.findFirst({
      where: { userId: owner.id, service: "SHOPIFY" },
      include: { credential: true },
    });
    expect(connection?.config).toContain(SHOP);
    expect(connection?.config).not.toContain(TOKEN);
    expect(connection?.credential?.encryptedPayload).not.toContain(TOKEN);
  });

  it("never writes the token into an event payload", async () => {
    const owner = await createTestUser();
    await connectStore(owner);
    const events = await db.event.findMany({ where: { userId: owner.id } });
    for (const event of events) {
      expect(event.payload ?? "").not.toContain(TOKEN);
    }
  });
});

// ---------------------------------------------------------------------------
// The evidence rule
// ---------------------------------------------------------------------------

describe("the external rule records provenance or records nothing", () => {
  const rule = OBSERVATION_RULES.EXTERNAL_ORDER_COUNT;

  it("is frozen like every other rule", () => {
    expect(() => {
      (rule as unknown as { unit: string }).unit = "dollars";
    }).toThrow();
  });

  it("says plainly that it establishes no causation, revenue or profit", () => {
    expect(rule.doesNotEstablish).toMatch(/causation/i);
    expect(rule.doesNotEstablish).toMatch(/revenue/i);
    expect(rule.doesNotEstablish).toMatch(/profit/i);
  });

  it("reads a successful tool output into a measurement with full provenance", () => {
    const outcome = rule.observe({
      observed: true,
      value: 4,
      unit: "orders",
      provider: "shopify",
      scope: SHOP,
      retrievedAt: "2026-01-09T00:00:00.000Z",
      responseDigest: "abc123",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-08T00:00:00.000Z",
      semantics: "DELTA_OVER_WINDOW",
    });
    expect(outcome).not.toBeNull();
    expect(outcome && "observedValue" in outcome && outcome.observedValue).toBe(4);
    expect(outcome && "external" in outcome && outcome.external?.scope).toBe(SHOP);
  });

  it("refuses a LEVEL_AT_INSTANT answer under a delta rule", () => {
    // The attack: a store's lifetime total, recorded as one experiment's result.
    const outcome = rule.observe({
      observed: true,
      value: 250_000,
      unit: "orders",
      provider: "shopify",
      scope: SHOP,
      retrievedAt: "2026-01-09T00:00:00.000Z",
      responseDigest: "abc",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-08T00:00:00.000Z",
      semantics: "LEVEL_AT_INSTANT",
    });
    expect(outcome).toBeNull();
  });

  it("reads a refusal as a non-answer, never as a zero", () => {
    const outcome = rule.observe({ observed: false, failure: "PROVIDER_THROTTLED", detail: "throttled" });
    expect(outcome).not.toBeNull();
    expect(outcome && "notObserved" in outcome).toBe(true);
    expect(outcome && "observedValue" in outcome).toBe(false);
  });

  it("refuses an output missing any provenance field", () => {
    const complete = {
      observed: true,
      value: 4,
      provider: "shopify",
      scope: SHOP,
      retrievedAt: "2026-01-09T00:00:00.000Z",
      responseDigest: "abc",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-08T00:00:00.000Z",
      semantics: "DELTA_OVER_WINDOW",
    };
    for (const key of ["provider", "scope", "retrievedAt", "responseDigest", "windowStart", "windowEnd"]) {
      const partial: Record<string, unknown> = { ...complete };
      delete partial[key];
      expect(rule.observe(partial), key).toBeNull();
    }
  });

  it("refuses an unparseable date rather than recording an invalid instant", () => {
    expect(
      rule.observe({
        observed: true,
        value: 1,
        provider: "shopify",
        scope: SHOP,
        retrievedAt: "not a date",
        responseDigest: "abc",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-08T00:00:00.000Z",
        semantics: "DELTA_OVER_WINDOW",
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The post-hoc edit, at the measurement boundary
// ---------------------------------------------------------------------------

describe("the contract is re-checked before a measurement is written", () => {
  it("refuses to write a measurement when the contract changed after the retrieval", async () => {
    const owner = await createTestUser();
    await grantPermission(owner.id, "integration.shopify.read", "RECOMMEND");
    await connectStore(owner);
    const experiment = await makeDeclaredExperiment(owner);

    // A real, honest retrieval already sitting on a completed step.
    const run = await db.agentRun.create({
      data: { userId: owner.id, objective: "observe", status: "COMPLETED" },
    });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "observe",
        toolName: "economic.observe_orders",
        status: "COMPLETED",
        output: JSON.stringify({
          observed: true,
          value: 7,
          provider: "shopify",
          scope: SHOP,
          retrievedAt: new Date().toISOString(),
          responseDigest: "abc",
          windowStart: new Date().toISOString(),
          windowEnd: new Date().toISOString(),
          semantics: "DELTA_OVER_WINDOW",
        }),
      },
    });
    await db.experiment.update({
      where: { id: experiment.id },
      data: {
        executionRunId: run.id,
        // The edit: after the store answered, widen the window. The step's
        // output is unchanged and honest; what changed is what it is a
        // retrieval FOR.
        observationWindowMinutes: 60 * 24 * 60,
      },
    });

    const result = await observeExperimentExecution(owner.id, experiment.id);
    expect(result.observed).toBe(false);
    expect(result.observed === false && result.failure).toBe("CONTRACT_ALTERED");
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Policy classification
// ---------------------------------------------------------------------------

describe("reading someone else's records is classified as a read", () => {
  it("is READ, REVERSIBLE, not financial, and marked external", () => {
    const { classification } = classifyAction("tool", "economic.observe_orders");
    expect(classification.effect).toBe("READ");
    expect(classification.reversibility).toBe("REVERSIBLE");
    // Reading how many orders a shop recorded spends nothing and commits
    // nothing. Marking it financial would put a query in the same cell as a
    // transaction.
    expect(classification.financial).toBe(false);
    expect(classification.untrustedOutput).toBe(true);
    expect(classification.externalSystemOfRecord).toBe(true);
  });

  it("cannot be mutated at runtime into something more permissive", () => {
    const { classification } = classifyAction("tool", "economic.observe_orders");
    expect(() => {
      (classification as unknown as { externalSystemOfRecord: boolean }).externalSystemOfRecord = false;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

describe("the integration surface cannot grow by accident", () => {
  const shopifySource = readFileSync("src/lib/integrations/shopify.ts", "utf8");
  const portSource = readFileSync("src/lib/integrations/economic.ts", "utf8");

  /**
   * Comments stripped, so these scans are about CODE.
   *
   * The first version of the `write_orders` check below matched the doc comment
   * that says the scope is deliberately NOT requested — a test failing because
   * the source explains why it is safe is a test that punishes documentation.
   */
  function codeOnly(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("contains no GraphQL mutation", () => {
    // Extracted from the template literals rather than matched against prose,
    // so a doc comment mentioning the word cannot trip or mask this.
    const literals = shopifySource.match(/`[^`]*`/g) ?? [];
    for (const literal of literals) {
      expect(literal.toLowerCase()).not.toMatch(/\bmutation\s+\w+/);
    }
  });

  it("requires only the read scope", () => {
    expect(SHOPIFY_REQUIRED_SCOPE).toBe("read_orders");
    expect(codeOnly(shopifySource)).not.toContain("write_orders");
  });

  it("every method on the port is a read", () => {
    // ---- WIDENED IN P5-F, AND THE INVARIANT IS UNCHANGED -----------------
    //
    // This used to assert the port had exactly ONE method. P5-F added a second
    // (`sumOrderValueInWindow`), and that made this fail — correctly, because a
    // new method on this interface is a new capability and should never slip in
    // unnoticed.
    //
    // But the count was never the property worth protecting. Two reads can
    // between them cancel nothing and move no money. What matters is that no
    // method WRITES, so that is what is asserted now — by name, against an
    // allowlist. Adding a third read means adding it here deliberately; adding
    // anything that sounds like a write fails immediately.
    const body = portSource.slice(portSource.indexOf("interface EconomicObservationProvider"));
    const methods = (body.slice(0, body.indexOf("\n}")).match(/^\s+(\w+)\(/gm) ?? []).map((m) =>
      m.trim().replace("(", "")
    );
    expect(methods.sort()).toEqual(["countOrdersInWindow", "sumOrderValueInWindow"]);
    for (const method of methods) {
      expect(method).not.toMatch(/create|update|delete|cancel|refund|write|set|send|charge/i);
    }
  });

  it("the failure arm of the outcome type carries no value field", () => {
    const refusal = portSource.slice(
      portSource.indexOf("interface ObservationRefusal"),
      portSource.indexOf("export type ObservationOutcome")
    );
    // This is what makes `?? 0` a compile error rather than a code review note.
    expect(refusal).not.toMatch(/^\s+value[?]?:/m);
  });

  it("the provider never writes to the database", () => {
    expect(codeOnly(shopifySource)).not.toContain("@/lib/db");
    expect(codeOnly(shopifySource)).not.toMatch(/\bdb\./);
  });

  it("the port mints no permission", () => {
    for (const forbidden of ["grantPermission", "createApprovalGrant", "enforceCapability"]) {
      expect(codeOnly(portSource)).not.toContain(forbidden);
    }
  });
});
