/**
 * [P6-F] EXPERIMENT-BOUND COMMERCIAL INTERVENTION — adversarial tests.
 *
 * Most of this chain already existed, and the honest framing matters for reading
 * the tests below. P5-G gave `CommercialAction` an `experimentId` (UNIQUE), froze
 * it by digest, put execution behind `integration.shopify.write` at ACT with a
 * policy HOLD and therefore an argument-bound `ApprovalGrant`, and bound
 * `executionRunId`/`executionStepId` uniquely to the action.
 *
 * What did not exist: the `externalId` went nowhere. The observation contract
 * named a store and a window and no subject, so a declared window meant "every
 * order this store took in this period" — a measurement OF THE STORE. An
 * experiment could be credited with a week of ordinary trading it had nothing to
 * do with, and the code it created was decoration.
 *
 * So these are the questions:
 *
 *   Can a window attribute to a code the experiment did not create?
 *   Can the subject be repointed after the contract was frozen?
 *   Can an UNKNOWN execution produce an attributed measurement?
 *   Does the completeness proof survive attribution?
 *   Is an unredeemed code an observed zero, or a failure?
 *   Does any of this create a second way to execute or authorize?
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { connectShopifyStore } from "@/lib/connections/shopify";
import { SHOPIFY_WRITE_SCOPE } from "@/lib/integrations/shopifyCommerce";
import {
  declareCommercialAction,
  executeCommercialAction,
  type ExecuteResult,
} from "@/lib/commerce/execute";
import {
  validateDiscountParameters,
  type DiscountCodeParameters,
} from "@/lib/commerce/contract";
import { bindObservationSubject, interventionState } from "@/lib/commerce/intervention";
import {
  declareObservationContract,
  observeDeclaredOrderValue,
  EXTERNAL_ORDER_VALUE_RULE,
} from "@/lib/economic/externalObservation";
import { observationContractDigestOf } from "@/lib/economic/observationContract";
import { ShopifyOrderCountProvider } from "@/lib/integrations/shopify";
import { grantPermission } from "@/lib/permissions/service";
import { createApprovalGrant } from "@/lib/policy/approvals";
import { createAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

const SHOP = "vox-intervention.myshopify.com";
const TOKEN = "shpat_interventiontoken0123";
const TOOL = "commerce.create_discount_code";
const CAPABILITY = "integration.shopify.write";
const CODE = "VOXEXP10";

/** The declared window. Past, so it is closed and inside the grace period. */
const WINDOW_START = new Date(Date.now() - 3 * 86_400_000);
const WINDOW_MINUTES = 60;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubPages(bodies: unknown[], status = 200) {
  let index = 0;
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    if (body instanceof Error) throw body;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const okCount = { data: { ordersCount: { count: 0, precision: "EXACT" } } };

/**
 * FIXED, not `Date.now()`-relative.
 *
 * `echoMatches()` compares every authorized parameter against the provider's
 * response, so a fixture that recomputes its timestamps per call declares one
 * set of dates and echoes another — and the write comes back as a mismatch
 * rather than a success. That is the echo check working; it is also how this
 * fixture's first version failed.
 */
const DISCOUNT_START = new Date("2026-10-01T00:00:00.000Z");
const DISCOUNT_END = new Date("2026-10-20T00:00:00.000Z");

function params(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    code: CODE,
    title: "VOX experiment discount",
    percentageFraction: 0.1,
    startsAt: DISCOUNT_START.toISOString(),
    endsAt: DISCOUNT_END.toISOString(),
    usageLimit: 25,
    appliesOncePerCustomer: true,
    ...over,
  };
}

function validated(over: Partial<Record<string, unknown>> = {}): DiscountCodeParameters {
  const v = validateDiscountParameters(params(over));
  if (!v.valid) throw new Error(`fixture invalid: ${v.violations.join(",")}`);
  return v.parameters;
}

/** A faithful Shopify create response. */
function createdOk(p: DiscountCodeParameters = validated(), id = "gid://shopify/DiscountCodeNode/1") {
  return {
    data: {
      discountCodeBasicCreate: {
        codeDiscountNode: {
          id,
          codeDiscount: {
            title: p.title,
            status: "ACTIVE",
            startsAt: p.startsAt.toISOString(),
            endsAt: p.endsAt.toISOString(),
            usageLimit: p.usageLimit,
            appliesOncePerCustomer: p.appliesOncePerCustomer,
            codes: { nodes: [{ code: p.code }] },
            customerGets: {
              value: { percentage: p.percentageFraction },
              items: { allItems: true },
            },
          },
        },
        userErrors: [],
      },
    },
  };
}

/**
 * A value page whose orders carry discount codes.
 *
 * `discountCodes` is `[String!]!` on `Order` — verified against the live Admin
 * schema rather than assumed.
 */
function valuePage(orders: { amount: string; codes: string[] }[], over: { count?: number; currency?: string } = {}) {
  const currency = over.currency ?? "USD";
  return {
    data: {
      shop: { currencyCode: currency },
      ordersCount: { count: over.count ?? orders.length, precision: "EXACT" },
      orders: {
        pageInfo: { hasNextPage: false, endCursor: "cursor-1" },
        edges: orders.map((order, i) => ({
          node: {
            id: `gid://shopify/Order/i${i}`,
            totalPriceSet: { shopMoney: { amount: order.amount, currencyCode: currency } },
            discountCodes: order.codes,
          },
        })),
      },
    },
  };
}

async function connectWritable(owner: User) {
  stubPages([okCount]);
  const result = await connectShopifyStore({
    userId: owner.id,
    shopDomain: SHOP,
    accessToken: TOKEN,
    declaredWriteScopes: [SHOPIFY_WRITE_SCOPE, "read_discounts", "read_orders"],
  });
  globalThis.fetch = realFetch;
  if (!result.connected) throw new Error("fixture connect failed");
  return result;
}

/** An experiment with a declared intervention and a declared window naming it. */
async function declaredChain(owner: User, over: { subject?: string; code?: string } = {}) {
  const experiment = await db.experiment.create({
    data: { userId: owner.id, hypothesis: `I ${Math.random().toString(36).slice(2)}` },
  });
  const action = await declareCommercialAction({
    userId: owner.id,
    experimentId: experiment.id,
    externalScope: SHOP,
    parameters: params(over.code ? { code: over.code } : {}),
  });
  if (!action.declared) throw new Error(`declare failed: ${action.reason}`);

  const contract = await declareObservationContract({
    userId: owner.id,
    experimentId: experiment.id,
    rule: EXTERNAL_ORDER_VALUE_RULE,
    externalScope: SHOP,
    windowStart: WINDOW_START,
    windowMinutes: WINDOW_MINUTES,
    observationSubject: over.subject ?? over.code ?? CODE,
  });
  return { experiment, action: action.action, digest: action.digest, contract };
}

/** Executes the declared action through the EXISTING gated path, with a grant. */
async function executeAuthorized(owner: User, actionId: string, digest: string) {
  await grantPermission(owner.id, CAPABILITY, "ACT");
  const run = await createAgentRun({
    userId: owner.id,
    objective: "create the authorized discount",
    steps: [{ description: "create discount", toolName: TOOL, input: { actionId, contractDigest: digest } }],
  });
  const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;
  await createApprovalGrant({
    userId: owner.id,
    registry: "tool",
    actionId: TOOL,
    parsedArguments: { actionId, contractDigest: digest },
    policyDecision: "HOLD",
    capability: CAPABILITY,
    requiredLevel: "ACT",
    targetType: "AgentStep",
    targetId: step.id,
  });
  const calls = stubPages([createdOk()]);
  const executed = await executeRun(owner.id, run.id);
  globalThis.fetch = realFetch;
  return { run, step, executed, calls };
}

// ---------------------------------------------------------------------------
// 1. The experiment binding
// ---------------------------------------------------------------------------

describe("an experiment declares exactly one intervention", () => {
  it("DECLARES AN INTERVENTION BOUND TO THE EXPERIMENT", async () => {
    const owner = await createTestUser();
    const { experiment, action } = await declaredChain(owner);
    expect(action.experimentId).toBe(experiment.id);
    expect(action.status).toBe("PLANNED");
    // Nothing external, nothing authorized, nothing executed.
    expect(action.externalId).toBeNull();
    expect(action.executionRunId).toBeNull();
    expect(action.executionStepId).toBeNull();
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("REFUSES A SECOND INTERVENTION FOR THE SAME EXPERIMENT", async () => {
    const owner = await createTestUser();
    const { experiment } = await declaredChain(owner);
    const second = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params({ code: "VOXOTHER9" }),
    });
    expect(second.declared).toBe(false);
    expect(second.declared === false && second.reason).toBe("ALREADY_DECLARED");
    expect(await db.commercialAction.count({ where: { experimentId: experiment.id } })).toBe(1);
  });

  it("REFUSES A WINDOW ATTRIBUTING TO A CODE THIS EXPERIMENT DID NOT CREATE", async () => {
    // The check that makes attribution an EXPERIMENT binding rather than a
    // free-text filter. Without it a window could claim another intervention's
    // orders.
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "mismatched" },
    });
    const declared = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params(),
    });
    expect(declared.declared).toBe(true);

    const contract = await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
      observationSubject: "SOMEONEELSESCODE",
    });
    expect(contract.declared).toBe(false);
    expect(contract.declared === false && contract.reason).toBe("SUBJECT_MISMATCH");
  });

  it("REFUSES A SUBJECT WHEN THERE IS NO INTERVENTION AT ALL", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "no intervention" },
    });
    const contract = await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
      observationSubject: CODE,
    });
    expect(contract.declared).toBe(false);
    expect(contract.declared === false && contract.reason).toBe("SUBJECT_MISMATCH");
  });

  it("A SUBJECTLESS WINDOW STILL WORKS, AND ITS DIGEST IS UNCHANGED", async () => {
    // Every P5-E/F observation. The subject is appended to the digest only when
    // present, so historical contracts hash exactly as they did and
    // `verifyEvidenceIntegrity()` does not report them as altered.
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "whole window" },
    });
    const contract = await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
    });
    expect(contract.declared).toBe(true);
    if (!contract.declared) return;
    expect(contract.subject).toBeNull();

    const row = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(row.observationSubject).toBeNull();
    // The pre-P6-F digest, byte for byte.
    const legacy = observationContractDigestOf({
      rule: EXTERNAL_ORDER_VALUE_RULE,
      scope: SHOP,
      windowStart: row.observationWindowStart!,
      windowMinutes: row.observationWindowMinutes!,
    });
    expect(row.observationContractDigest).toBe(legacy);
    // And a subject is not absorbable into the same hash.
    expect(
      observationContractDigestOf({
        rule: EXTERNAL_ORDER_VALUE_RULE,
        scope: SHOP,
        windowStart: row.observationWindowStart!,
        windowMinutes: row.observationWindowMinutes!,
        subject: CODE,
      })
    ).not.toBe(legacy);
  });
});

// ---------------------------------------------------------------------------
// 2. Authorization is unchanged, and there is no second path
// ---------------------------------------------------------------------------

describe("the existing authorization boundary still binds", () => {
  it("AN UNAPPROVED INTERVENTION DOES NOT EXECUTE AND CALLS NOTHING", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredChain(owner);

    const run = await createAgentRun({
      userId: owner.id,
      objective: "create the discount without approval",
      steps: [{ description: "create", toolName: TOOL, input: { actionId: action.id, contractDigest: digest } }],
    });
    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
    const after = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(after.status).toBe("PLANNED");
    expect(after.externalId).toBeNull();
    // And nothing can be bound, so nothing can be observed.
    expect((await interventionState(owner.id, after.experimentId!))!.observable).toBe(false);
  });

  it("A GRANT FOR DIFFERENT PARAMETERS DOES NOT AUTHORIZE THIS ONE", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredChain(owner);
    const run = await createAgentRun({
      userId: owner.id,
      objective: "create the discount on a mismatched grant",
      steps: [{ description: "create", toolName: TOOL, input: { actionId: action.id, contractDigest: digest } }],
    });
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;
    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      // A different digest: the grant binds the hash of these arguments.
      parsedArguments: { actionId: action.id, contractDigest: "f".repeat(64) },
      policyDecision: "HOLD",
      capability: CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: step.id,
    });

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
    expect((await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("PLANNED");
  });

  it("THE INTERVENTION MODULE OPENS NO SECOND EXECUTION OR AUTHORIZATION PATH", () => {
    // A symbol that is never imported cannot be called. The binding reads an
    // action that already succeeded through the gated path; it cannot run one.
    // Comments stripped first: the module's own doc block explains which
    // functions it deliberately does NOT import, and the word "imports" inside
    // that prose otherwise starts a spurious match that spans into real code.
    const source = readFileSync("src/lib/commerce/intervention.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = (code.match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
    for (const forbidden of [
      "executeCommercialAction",
      "declareCommercialAction",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "grantPermission",
      "enforceCapability",
      "executeRun",
      "getCommercialWriteProvider",
    ]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
    // And it performs no fetch of its own.
    expect(code).not.toContain("fetch(");
  });
});

// ---------------------------------------------------------------------------
// 3. The full authorized chain, and its identity
// ---------------------------------------------------------------------------

describe("the authorized intervention's identity reaches the observation", () => {
  it("EXECUTES ONCE AND CARRIES THE FULL EXECUTION IDENTITY", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    const { run, step, executed, calls } = await executeAuthorized(owner, action.id, digest);

    expect(executed.status).toBe("COMPLETED");
    expect(calls).toHaveLength(1);

    const after = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(after.status).toBe("SUCCEEDED");
    expect(after.externalId).toBe("gid://shopify/DiscountCodeNode/1");
    // The three identities the brief names, all on the row.
    expect(after.experimentId).toBe(experiment.id);
    expect(after.executionRunId).toBe(run.id);
    expect(after.executionStepId).toBe(step.id);
  });

  it("BINDS THE EXTERNAL ID AS THE WINDOW'S CONFIRMED SUBJECT", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);

    // Before binding, the window names a subject nobody has confirmed exists.
    const before = await interventionState(owner.id, experiment.id);
    expect(before!.observationSubject).toBe(CODE);
    expect(before!.observationSubjectExternalId).toBeNull();
    expect(before!.observable).toBe(false);
    expect(before!.blocker).toMatch(/not been confirmed/i);

    const bound = await bindObservationSubject(owner.id, experiment.id);
    expect(bound.bound).toBe(true);
    if (!bound.bound) return;
    expect(bound.subject).toBe(CODE);
    expect(bound.externalId).toBe("gid://shopify/DiscountCodeNode/1");

    const after = await interventionState(owner.id, experiment.id);
    expect(after!.observationSubjectExternalId).toBe("gid://shopify/DiscountCodeNode/1");
    expect(after!.observable).toBe(true);
    expect(after!.blocker).toBeNull();
    // The identity chain, end to end, on one read.
    expect(after!.action!.executionRunId).not.toBeNull();
    expect(after!.action!.executionStepId).not.toBeNull();
    expect(after!.action!.code).toBe(CODE);

    const event = await db.event.findFirstOrThrow({
      where: { userId: owner.id, type: "economic.intervention.subject_bound" },
    });
    expect(event.consequential).toBe(true);
    const payload = JSON.parse(event.payload ?? "{}");
    expect(payload.externalId).toBe("gid://shopify/DiscountCodeNode/1");
    expect(payload.note).toMatch(/not causation/i);
  });

  it("THE OBSERVATION ATTRIBUTES ONLY TO THE INTERVENTION'S OWN CODE", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);
    expect((await bindObservationSubject(owner.id, experiment.id)).bound).toBe(true);

    // Four orders in the window; two carry the code.
    stubPages([
      valuePage([
        { amount: "10.00", codes: [CODE] },
        { amount: "25.50", codes: ["SOMETHINGELSE"] },
        { amount: "40.00", codes: [] },
        { amount: "5.25", codes: ["OTHER", CODE] },
      ]),
    ]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    // $10.00 + $5.25 = $15.25, NOT the $80.75 the whole window took.
    expect(outcome.amountMinor).toBe(1_525);
    expect(outcome.amountScale).toBe(2);
    expect(outcome.currency).toBe("USD");
    expect(outcome.attributedOrderCount).toBe(2);
    expect(outcome.subject).toBe(CODE);
    // THE COMPLETENESS PROOF IS UNCHANGED: the whole window was still read and
    // still checked against the store's own count. That is what makes the
    // subset trustworthy.
    expect(outcome.orderCount).toBe(4);
  });

  it("AN UNREDEEMED CODE IS AN OBSERVED ZERO, NOT A FAILURE", async () => {
    // The code existed, the window was read completely, nobody used it. The
    // most useful result an intervention experiment can produce.
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);
    await bindObservationSubject(owner.id, experiment.id);

    stubPages([
      valuePage([
        { amount: "10.00", codes: [] },
        { amount: "25.50", codes: ["SOMETHINGELSE"] },
      ]),
    ]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(0);
    expect(outcome.attributedOrderCount).toBe(0);
    expect(outcome.orderCount).toBe(2);
  });

  it("A WINDOW WITH NO SUBJECT STILL SUMS THE WHOLE WINDOW", async () => {
    // P5-F behaviour, unchanged, and proven side by side with attribution so
    // the two cannot be confused.
    const owner = await createTestUser();
    await connectWritable(owner);
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "whole window" },
    });
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
    });

    stubPages([
      valuePage([
        { amount: "10.00", codes: [CODE] },
        { amount: "25.50", codes: [] },
      ]),
    ]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(true);
    if (!outcome.observed) return;
    expect(outcome.amountMinor).toBe(3_550);
    expect(outcome.attributedOrderCount).toBeNull();
    expect(outcome.subject).toBeNull();
  });

  it("AN UNREADABLE DISCOUNT LIST IS A REFUSAL, NOT AN UNATTRIBUTED ORDER", async () => {
    // Reading a malformed list as "carried no code" would silently drop a real
    // redemption, producing a smaller total that looks exactly like a real one.
    // No user needed: this exercises the provider directly, which is where the
    // refusal lives.
    const provider = new ShopifyOrderCountProvider();
    stubPages([
      {
        data: {
          shop: { currencyCode: "USD" },
          ordersCount: { count: 1, precision: "EXACT" },
          orders: {
            pageInfo: { hasNextPage: false, endCursor: "c" },
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/1",
                  totalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
                  discountCodes: "VOXEXP10",
                },
              },
            ],
          },
        },
      },
    ]);
    const outcome = await provider.sumOrderValueInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: WINDOW_START,
      windowEnd: new Date(WINDOW_START.getTime() + 60_000),
      subject: CODE,
    });
    globalThis.fetch = realFetch;
    expect(outcome.observed).toBe(false);
    if (outcome.observed) return;
    expect(outcome.failure).toBe("PROVIDER_UNAVAILABLE");
    expect(outcome.detail).toMatch(/unreadable discount-code list/i);
  });

  it("matches a redemption case-insensitively", async () => {
    // Shopify discount codes are case-insensitive at checkout, so an order
    // placed with "voxexp10" is the same redemption. Comparing exactly would
    // under-attribute, which is the same class of error as a short sum.
    const provider = new ShopifyOrderCountProvider();
    stubPages([valuePage([{ amount: "12.00", codes: ["voxexp10"] }])]);
    const outcome = await provider.sumOrderValueInWindow({
      scope: SHOP,
      accessToken: TOKEN,
      windowStart: WINDOW_START,
      windowEnd: new Date(WINDOW_START.getTime() + 60_000),
      subject: CODE,
    });
    globalThis.fetch = realFetch;
    expect(outcome.observed && outcome.amountMinor).toBe(1_200);
    expect(outcome.observed && outcome.attributedOrderCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. UNKNOWN stays unknown
// ---------------------------------------------------------------------------

describe("an ambiguous execution produces no measurement", () => {
  /** Drives a real UNKNOWN: the request is sent and the answer never arrives. */
  async function executeToUnknown(owner: User, actionId: string, digest: string): Promise<ExecuteResult> {
    stubPages([new Error("socket hang up")]);
    const result = await executeCommercialAction({ userId: owner.id, actionId, contractDigest: digest });
    globalThis.fetch = realFetch;
    return result;
  }

  it("AN UNKNOWN WRITE CANNOT BE BOUND AS A SUBJECT", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);

    const result = await executeToUnknown(owner, action.id, digest);
    expect(result.executed).toBe(false);
    expect(result.executed === false && result.status).toBe("UNKNOWN");

    const row = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(row.status).toBe("UNKNOWN");
    expect(row.externalId).toBeNull();
    // The point of no return was crossed, so the request may have landed.
    expect(row.submittedAt).not.toBeNull();

    const bound = await bindObservationSubject(owner.id, experiment.id);
    expect(bound.bound).toBe(false);
    expect(bound.bound === false && bound.reason).toBe("NOT_APPLIED");
    expect(bound.bound === false && bound.detail).toMatch(/invent exactly the certainty/i);
  });

  it("AND THE WINDOW CANNOT BE OBSERVED, SO NO MEASUREMENT IS FABRICATED", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeToUnknown(owner, action.id, digest);

    const calls = stubPages([valuePage([{ amount: "10.00", codes: [CODE] }])]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(false);
    if (outcome.observed) return;
    expect(outcome.failure).toBe("NO_CONTRACT");
    expect(outcome.detail).toMatch(/has not been confirmed/i);
    // THE STORE WAS NEVER ASKED. An ambiguous intervention does not get to
    // produce a number at all.
    expect(calls).toHaveLength(0);
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);

    const state = await interventionState(owner.id, experiment.id);
    expect(state!.observable).toBe(false);
    expect(state!.blocker).toMatch(/UNKNOWN/);
  });

  it("A PLANNED OR FAILED INTERVENTION IS NOT A CONFIRMED SUBJECT EITHER", async () => {
    const owner = await createTestUser();
    const { experiment } = await declaredChain(owner);

    const planned = await bindObservationSubject(owner.id, experiment.id);
    expect(planned.bound === false && planned.reason).toBe("NOT_APPLIED");

    await db.commercialAction.updateMany({
      where: { experimentId: experiment.id },
      data: { status: "FAILED", failureCode: "PROVIDER_REJECTED" },
    });
    const failed = await bindObservationSubject(owner.id, experiment.id);
    expect(failed.bound === false && failed.reason).toBe("NOT_APPLIED");
  });
});

// ---------------------------------------------------------------------------
// 5. Replay, repointing and isolation
// ---------------------------------------------------------------------------

describe("the binding cannot be replayed or repointed", () => {
  it("BINDS ONCE — A SECOND BIND IS REFUSED, NOT OVERWRITTEN", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);

    expect((await bindObservationSubject(owner.id, experiment.id)).bound).toBe(true);
    const second = await bindObservationSubject(owner.id, experiment.id);
    expect(second.bound).toBe(false);
    expect(second.bound === false && second.reason).toBe("ALREADY_BOUND");

    // One event, not two.
    expect(
      await db.event.count({
        where: { userId: owner.id, type: "economic.intervention.subject_bound" },
      })
    ).toBe(1);
  });

  it("REPLAYING THE EXECUTION CREATES NO SECOND COMMERCIAL EFFECT", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);

    // The same action again, with a fresh grant. The action is no longer
    // PLANNED, so the store is never called a second time.
    const calls = stubPages([createdOk()]);
    const replay = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    expect(replay.executed).toBe(false);
    expect(replay.executed === false && replay.status).toBe("REFUSED");
    expect(replay.executed === false && replay.status === "REFUSED" && replay.reason).toBe("NOT_PLANNABLE");
    expect(calls).toHaveLength(0);
  });

  it("REPOINTING THE SUBJECT AFTER THE FREEZE BREAKS THE CONTRACT", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);
    await bindObservationSubject(owner.id, experiment.id);

    // Edited directly in the database, which is the only way to do it.
    await db.experiment.update({
      where: { id: experiment.id },
      data: { observationSubject: "DIFFERENTCODE" },
    });

    const calls = stubPages([valuePage([{ amount: "10.00", codes: ["DIFFERENTCODE"] }])]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(false);
    if (outcome.observed) return;
    expect(outcome.failure).toBe("CONTRACT_ALTERED");
    expect(calls).toHaveLength(0);
  });

  it("refuses to bind a subject onto a whole-window contract", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "whole window with an action" },
    });
    const declared = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params(),
    });
    expect(declared.declared).toBe(true);
    if (!declared.declared) return;
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
    });
    await executeAuthorized(owner, declared.action.id, declared.digest);

    const bound = await bindObservationSubject(owner.id, experiment.id);
    expect(bound.bound).toBe(false);
    expect(bound.bound === false && bound.reason).toBe("SUBJECT_MISMATCH");
    expect(bound.bound === false && bound.detail).toMatch(/names no subject/i);
  });

  it("is isolated per user", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { experiment, action, digest } = await declaredChain(owner);
    await executeAuthorized(owner, action.id, digest);

    const other = await createTestUser();
    const bound = await bindObservationSubject(other.id, experiment.id);
    expect(bound.bound).toBe(false);
    expect(bound.bound === false && bound.reason).toBe("EXPERIMENT_NOT_FOUND");
    expect(await interventionState(other.id, experiment.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. No credentials, no architectural failure
// ---------------------------------------------------------------------------

describe("without credentials the path refuses rather than breaking", () => {
  it("EXECUTION REFUSES NOT_CONFIGURED AND SENDS NOTHING", async () => {
    const owner = await createTestUser();
    // No store connected at all.
    const { action, digest } = await declaredChain(owner);
    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    expect(result.executed).toBe(false);
    expect(result.executed === false && result.status).toBe("REFUSED");
    expect(calls).toHaveLength(0);
    expect((await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("PLANNED");
  });

  it("OBSERVATION REFUSES WITHOUT A CREDENTIAL AND PRODUCES NO ZERO", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "no credential" },
    });
    await declareObservationContract({
      userId: owner.id,
      experimentId: experiment.id,
      rule: EXTERNAL_ORDER_VALUE_RULE,
      externalScope: SHOP,
      windowStart: WINDOW_START,
      windowMinutes: WINDOW_MINUTES,
    });

    const calls = stubPages([valuePage([{ amount: "10.00", codes: [] }])]);
    const outcome = await observeDeclaredOrderValue(owner.id, experiment.id);
    globalThis.fetch = realFetch;

    expect(outcome.observed).toBe(false);
    if (outcome.observed) return;
    // The refusal arm carries no amount at all, so "no credential" cannot be
    // read as "the store took nothing".
    expect("amountMinor" in outcome).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
