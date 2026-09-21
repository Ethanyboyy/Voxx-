/**
 * [P5-G] ONE AUTHORIZED COMMERCIAL ACTION — adversarial tests.
 *
 * Every prior phase asked "can a number nobody measured become evidence". This
 * one asks something with teeth: CAN SOMETHING HAPPEN IN A MERCHANT'S STORE
 * THAT NOBODY AUTHORIZED, OR HAPPEN TWICE, OR BE REPORTED AS HAVING HAPPENED
 * WHEN IT DID NOT?
 *
 * The attacks, in order: execute with no grant; with someone else's grant; with
 * a grant for a different action; with edited parameters; from a different
 * execution identity; with a spent or expired grant; past a policy denial; and
 * then the harder half — turn a failure into a success, turn a timeout into a
 * success, turn a crash into a retry, and turn a created discount into revenue.
 *
 * As in P5-E/P5-F there is NO mock provider in `src/`: `globalThis.fetch` is
 * stubbed and the real `ShopifyCommerceProvider` does the parsing.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import { grantPermission } from "@/lib/permissions/service";
import { classifyAction } from "@/lib/policy/classification";
import { evaluatePolicy } from "@/lib/policy/gate";
import { createApprovalGrant } from "@/lib/policy/approvals";
import { startAgentRun, createAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { connectShopifyStore } from "@/lib/connections/shopify";
import { ShopifyCommerceProvider, SHOPIFY_WRITE_SCOPE } from "@/lib/integrations/shopifyCommerce";
import {
  commercialContractDigestOf,
  validateDiscountParameters,
  describeDiscountAction,
  MAX_DISCOUNT_FRACTION,
  MAX_USAGE_LIMIT,
  type DiscountCodeParameters,
} from "@/lib/commerce/contract";
import {
  declareCommercialAction,
  executeCommercialAction,
  observeCommercialAction,
  getCommercialAction,
  listCommercialActions,
} from "@/lib/commerce/execute";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

const SHOP = "vox-write-store.myshopify.com";
const TOKEN = "shpat_writetoken0123456789";
const TOOL = "commerce.create_discount_code";
const CAPABILITY = "integration.shopify.write";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubPages(bodies: unknown[], status = 200) {
  let index = 0;
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init.body),
      headers: (init.headers ?? {}) as Record<string, string>,
    });
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

const START = new Date("2026-10-01T00:00:00.000Z");
const END = new Date("2026-10-08T00:00:00.000Z");

function params(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    code: "VOXTEST10",
    title: "VOX experiment discount",
    percentageFraction: 0.1,
    startsAt: START.toISOString(),
    endsAt: END.toISOString(),
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

/** A well-formed Shopify create response that echoes the request faithfully. */
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
            customerGets: { value: { percentage: p.percentageFraction } },
          },
        },
        userErrors: [],
      },
    },
  };
}

function foundOk(p: DiscountCodeParameters = validated(), redemptions = 0, id = "gid://shopify/DiscountCodeNode/1") {
  return {
    data: {
      codeDiscountNodeByCode: {
        id,
        codeDiscount: {
          title: p.title,
          status: "ACTIVE",
          startsAt: p.startsAt.toISOString(),
          endsAt: p.endsAt.toISOString(),
          usageLimit: p.usageLimit,
          asyncUsageCount: redemptions,
          appliesOncePerCustomer: p.appliesOncePerCustomer,
          codes: { nodes: [{ code: p.code }] },
          customerGets: { value: { percentage: p.percentageFraction } },
        },
      },
    },
  };
}

const okCount = { data: { ordersCount: { count: 0, precision: "EXACT" } } };

let user: User;
beforeAll(async () => {
  user = await createTestUser();
});

/** Connects a store whose token declares the write scope. */
async function connectWritable(owner: User, shop = SHOP, scopes = [SHOPIFY_WRITE_SCOPE, "read_discounts"]) {
  stubPages([okCount]);
  const result = await connectShopifyStore({
    userId: owner.id,
    shopDomain: shop,
    accessToken: TOKEN,
    declaredWriteScopes: scopes,
  });
  globalThis.fetch = realFetch;
  return result;
}

async function declaredAction(owner: User, over: Partial<Record<string, unknown>> = {}) {
  const experiment = await db.experiment.create({
    data: { userId: owner.id, hypothesis: `W ${Math.random().toString(36).slice(2)}` },
  });
  const result = await declareCommercialAction({
    userId: owner.id,
    experimentId: experiment.id,
    externalScope: SHOP,
    parameters: params(over),
  });
  if (!result.declared) throw new Error(`declare failed: ${result.reason}`);
  return { experiment, action: result.action, digest: result.digest };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe("the action contract is bounded in size, count and time", () => {
  it("accepts a well-formed bounded action", () => {
    const v = validateDiscountParameters(params());
    expect(v.valid).toBe(true);
  });

  it("refuses a percentage above the ceiling", () => {
    const v = validateDiscountParameters(params({ percentageFraction: 0.9 }));
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.violations).toContain("PERCENTAGE_OUT_OF_RANGE");
    expect(MAX_DISCOUNT_FRACTION).toBeLessThan(1);
  });

  it("catches the units mistake by name — 5 meaning five percent", () => {
    // The 10,000x error. `5` is a plausible-looking "percentage" that Shopify
    // would read as 500% off. It gets its own violation code because the fix is
    // a different unit, not a smaller number.
    const v = validateDiscountParameters(params({ percentageFraction: 5 }));
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.violations).toContain("PERCENTAGE_NOT_A_FRACTION");
  });

  it("refuses an unbounded usage limit", () => {
    for (const usageLimit of [undefined, null, 0, -1, 1.5, MAX_USAGE_LIMIT + 1]) {
      const v = validateDiscountParameters(params({ usageLimit }));
      expect(v.valid, String(usageLimit)).toBe(false);
      expect(v.valid === false && v.violations).toContain("USAGE_LIMIT_INVALID");
    }
  });

  it("refuses an action with no end", () => {
    const v = validateDiscountParameters(params({ endsAt: undefined }));
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.violations).toContain("WINDOW_INVALID");
  });

  it("refuses a window that never closes within the allowed horizon", () => {
    const v = validateDiscountParameters(
      params({ endsAt: new Date(START.getTime() + 400 * 24 * 60 * 60 * 1000).toISOString() })
    );
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.violations).toContain("WINDOW_TOO_LONG");
  });

  it("refuses an end before its start", () => {
    const v = validateDiscountParameters(params({ startsAt: END.toISOString(), endsAt: START.toISOString() }));
    expect(v.valid).toBe(false);
  });

  it("refuses a code shape a store might treat specially", () => {
    for (const code of ["a b", "OK", "", "VOX;DROP", "VOX/../X", "«VOX»", "x".repeat(40)]) {
      expect(validateDiscountParameters(params({ code })).valid, code).toBe(false);
    }
  });

  it("reports every violation at once, not just the first", () => {
    const v = validateDiscountParameters(params({ code: "!", usageLimit: 0, percentageFraction: 5 }));
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.violations.length).toBeGreaterThanOrEqual(3);
  });

  it("the digest covers every parameter", () => {
    const base = validated();
    const original = commercialContractDigestOf({ kind: "DISCOUNT_CODE", externalScope: SHOP, parameters: base });
    expect(commercialContractDigestOf({ kind: "DISCOUNT_CODE", externalScope: SHOP, parameters: base })).toBe(original);

    const mutations: Partial<Record<string, unknown>>[] = [
      { code: "VOXTEST20" },
      { title: "Something else" },
      { percentageFraction: 0.2 },
      { usageLimit: 26 },
      { appliesOncePerCustomer: false },
      { startsAt: new Date(START.getTime() + 60_000).toISOString() },
      { endsAt: new Date(END.getTime() + 60_000).toISOString() },
    ];
    for (const m of mutations) {
      const digest = commercialContractDigestOf({
        kind: "DISCOUNT_CODE",
        externalScope: SHOP,
        parameters: validated(m),
      });
      expect(digest, JSON.stringify(m)).not.toBe(original);
    }
    // And the store is part of what was authorized.
    expect(
      commercialContractDigestOf({ kind: "DISCOUNT_CODE", externalScope: "other.myshopify.com", parameters: base })
    ).not.toBe(original);
  });

  it("carries no secret, so it is safe in an approval and an event", () => {
    const digest = commercialContractDigestOf({
      kind: "DISCOUNT_CODE",
      externalScope: SHOP,
      parameters: validated(),
    });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("describes the concession in percent and names both ceilings", () => {
    const description = describeDiscountAction(validated(), SHOP);
    expect(description).toContain("10%");
    expect(description).toContain("25 times");
    expect(description).toMatch(/does not charge anyone, move money, or create revenue/i);
  });
});

// ---------------------------------------------------------------------------
// Declaring
// ---------------------------------------------------------------------------

describe("an action is declared and frozen before it is authorized", () => {
  it("stores the parameters and the digest", async () => {
    const owner = await createTestUser();
    const { action, digest } = await declaredAction(owner);
    expect(action.status).toBe("PLANNED");
    expect(action.contractDigest).toBe(digest);
    expect(action.externalId).toBeNull();
    expect(action.submittedAt).toBeNull();
  });

  it("refuses a second action for the same experiment", async () => {
    const owner = await createTestUser();
    const { experiment } = await declaredAction(owner);
    const second = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params({ code: "VOXTEST20" }),
    });
    expect(second.declared).toBe(false);
    expect(second.declared === false && second.reason).toBe("ALREADY_DECLARED");
  });

  it("refuses to declare an intervention after the experiment already ran", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "already run", executionRunId: `run-${Math.random()}` },
    });
    const result = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params(),
    });
    expect(result.declared === false && result.reason).toBe("EXPERIMENT_DISPATCHED");
  });

  it("cannot declare against another user's experiment", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const experiment = await db.experiment.create({ data: { userId: owner.id, hypothesis: "mine" } });
    const result = await declareCommercialAction({
      userId: stranger.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params(),
    });
    expect(result.declared === false && result.reason).toBe("EXPERIMENT_NOT_FOUND");
  });

  it("refuses invalid parameters before anything is stored", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({ data: { userId: owner.id, hypothesis: "bad" } });
    const result = await declareCommercialAction({
      userId: owner.id,
      experimentId: experiment.id,
      externalScope: SHOP,
      parameters: params({ percentageFraction: 5 }),
    });
    expect(result.declared).toBe(false);
    expect(await db.commercialAction.count({ where: { userId: owner.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NO GRANT = NO EXECUTION. The heart of the phase.
// ---------------------------------------------------------------------------

describe("nothing reaches the store without the right grant", () => {
  /** Builds a one-step run that calls the write tool. */
  async function runFor(owner: User, actionId: string, digest: string) {
    return createAgentRun({
      userId: owner.id,
      objective: "create the authorized discount",
      steps: [
        {
          description: "create discount",
          toolName: TOOL,
          input: { actionId, contractDigest: digest },
        },
      ],
    });
  }

  it("the action is a HOLD, so the matrix alone never permits it", () => {
    const classification = classifyAction("tool", TOOL).classification;
    expect(evaluatePolicy({ action: classification }).decision).toBe("HOLD");
  });

  it("NO GRANT: the run parks and the store is never called", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);

    const run = await runFor(owner, action.id, digest);
    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
    const after = await db.commercialAction.findUnique({ where: { id: action.id } });
    expect(after?.status).toBe("PLANNED");
    expect(after?.submittedAt).toBeNull();
  });

  it("NO CAPABILITY: an ACT permission is required on top of any approval", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    // Deliberately NOT granting integration.shopify.write.
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
  });

  it("READ ACCESS IS NOT WRITE ACCESS", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    // The read capability at RECOMMEND — what P5-E/P5-F granted — is not
    // authorization to change anything, and cannot be made into it.
    await grantPermission(owner.id, "integration.shopify.read", "RECOMMEND");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
  });

  it("A CORRECT GRANT: the store is called exactly once and the code is created", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
      policyDecision: "HOLD",
      capability: CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: step.id,
    });

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;

    expect(executed.status).toBe("COMPLETED");
    expect(calls).toHaveLength(1);
    const after = await db.commercialAction.findUnique({ where: { id: action.id } });
    expect(after?.status).toBe("SUCCEEDED");
    expect(after?.externalId).toBe("gid://shopify/DiscountCodeNode/1");
    // Bound to the execution that performed it.
    expect(after?.executionRunId).toBe(run.id);
    expect(after?.executionStepId).toBe(step.id);
  });

  it("WRONG PARAMETERS: a grant for one discount does not authorize another", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    // The attack: approve a 10%-off code, then hash the grant against a
    // DIFFERENT digest — as would happen if the parameters were edited.
    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      // A grant whose arguments name a DIFFERENT discount — the shape that
      // results from editing the parameters after the approval was shown.
      parsedArguments: {
        actionId: action.id,
        contractDigest: commercialContractDigestOf({
          kind: "DISCOUNT_CODE",
          externalScope: SHOP,
          parameters: validated({ percentageFraction: 0.5 }),
        }),
      },
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
  });

  it("WRONG ACTION: a grant for another tool does not authorize this one", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: "economic.record_expense",
      parsedArguments: { actionId: action.id, contractDigest: digest },
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
  });

  it("WRONG EXECUTION IDENTITY: a grant bound to one step does not serve another", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);

    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
      policyDecision: "HOLD",
      capability: CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      // A step id that is not this run's step.
      targetId: `step-${Math.random()}`,
    });

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;
    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
  });

  it("WRONG USER: one account's grant never authorizes another's execution", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    await createApprovalGrant({
      userId: stranger.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
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
  });

  it("EXPIRED GRANT: an approval that has lapsed authorizes nothing", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    const grant = await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
      policyDecision: "HOLD",
      capability: CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: step.id,
    });
    await db.approvalGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;
    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
  });

  it("CONSUMED GRANT: one approval authorizes exactly one execution", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    await grantPermission(owner.id, CAPABILITY, "ACT");
    const { action, digest } = await declaredAction(owner);
    const run = await runFor(owner, action.id, digest);
    const step = (await db.agentStep.findFirst({ where: { runId: run.id } }))!;

    const grant = await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
      policyDecision: "HOLD",
      capability: CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: step.id,
    });
    await db.approvalGrant.update({ where: { id: grant.id }, data: { consumedAt: new Date() } });

    const calls = stubPages([createdOk()]);
    const executed = await executeRun(owner.id, run.id);
    globalThis.fetch = realFetch;
    expect(executed.status).toBe("WAITING_FOR_PERMISSION");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parameter drift and the service-level refusals
// ---------------------------------------------------------------------------

describe("what is sent is what was approved, or nothing is sent", () => {
  it("refuses when the parameters changed after the action was declared", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);

    // The attack: edit the row to a bigger discount, keeping the old digest in
    // the arguments — the shape a caller would take after an approval.
    await db.commercialAction.update({
      where: { id: action.id },
      data: { parameters: JSON.stringify({ ...params({ percentageFraction: 0.5 }) }) },
    });

    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    expect(result.executed).toBe(false);
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("CONTRACT_ALTERED");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the digest in the arguments is not the stored one", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action } = await declaredAction(owner);
    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({
      userId: owner.id,
      actionId: action.id,
      contractDigest: "0".repeat(64),
    });
    globalThis.fetch = realFetch;
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("CONTRACT_ALTERED");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the stored parameters no longer validate", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    await db.commercialAction.update({
      where: { id: action.id },
      data: { parameters: JSON.stringify({ ...params({ percentageFraction: 5 }) }) },
    });
    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("PARAMETERS_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the connected store is not the declared store", async () => {
    const owner = await createTestUser();
    await connectWritable(owner, "someone-else.myshopify.com");
    const { action, digest } = await declaredAction(owner);
    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("STORE_MISMATCH");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the credential carries only the read scope", async () => {
    const owner = await createTestUser();
    // Connected exactly as P5-E/P5-F would: read only, no declared write scope.
    await connectWritable(owner, SHOP, []);
    const { action, digest } = await declaredAction(owner);
    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("CREDENTIAL_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("refuses when no store is connected", async () => {
    const owner = await createTestUser();
    const { action, digest } = await declaredAction(owner);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    expect(result.executed === false && result.status === "REFUSED").toBe(true);
  });

  it("cannot execute another user's action", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    const result = await executeCommercialAction({ userId: stranger.id, actionId: action.id, contractDigest: digest });
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("NOT_FOUND");
  });

  it("sends exactly the authorized parameters and nothing else", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    const calls = stubPages([createdOk()]);
    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    const sent = JSON.parse(calls[0].body) as { variables: { basicCodeDiscount: Record<string, unknown> } };
    const d = sent.variables.basicCodeDiscount;
    expect(d.code).toBe("VOXTEST10");
    expect(d.usageLimit).toBe(25);
    // The FRACTION, unchanged — not multiplied, not divided.
    expect((d.customerGets as { value: { percentage: number } }).value.percentage).toBe(0.1);
    expect(d.startsAt).toBe(START.toISOString());
    expect(d.endsAt).toBe(END.toISOString());
    // The token travels in the header, never in the body or URL.
    expect(calls[0].body).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].headers["X-Shopify-Access-Token"]).toBe(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Provider failure is never success
// ---------------------------------------------------------------------------

describe("no provider response turns a failure into a success", () => {
  async function attempt(body: unknown, status = 200) {
    stubPages([body], status);
    const outcome = await new ShopifyCommerceProvider().createDiscountCode({
      scope: SHOP,
      accessToken: TOKEN,
      parameters: validated(),
    });
    globalThis.fetch = realFetch;
    return outcome;
  }

  it("userErrors under HTTP 200 is a refusal, not a creation", async () => {
    // The central hazard: a body that carries BOTH a 200 and a rejection.
    const outcome = await attempt({
      data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ message: "Title can't be blank", code: "INVALID" }] } },
    });
    expect(outcome.outcome).toBe("REFUSED");
    expect("externalId" in outcome).toBe(false);
  });

  it("a duplicate code is reported as ALREADY_EXISTS, not as a creation", async () => {
    const outcome = await attempt({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: null,
          userErrors: [{ message: "Code has already been taken", code: "TAKEN" }],
        },
      },
    });
    expect(outcome.outcome).toBe("REFUSED");
    expect(outcome.outcome === "REFUSED" && outcome.failure).toBe("ALREADY_EXISTS");
  });

  it("no errors AND no node is UNKNOWN, never a success", async () => {
    const outcome = await attempt({ data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [] } } });
    expect(outcome.outcome).toBe("UNKNOWN");
  });

  it("a missing userErrors field is UNKNOWN — silence is not consent", async () => {
    const outcome = await attempt({
      data: { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://x/1" } } },
    });
    expect(outcome.outcome).toBe("UNKNOWN");
  });

  it("a top-level errors[] under HTTP 200 is never a success", async () => {
    const outcome = await attempt({ errors: [{ message: "Throttled" }] });
    expect(outcome.outcome).not.toBe("APPLIED");
  });

  it("401 is a refusal — the mutation never ran", async () => {
    const outcome = await attempt({}, 401);
    expect(outcome.outcome).toBe("REFUSED");
    expect(outcome.outcome === "REFUSED" && outcome.failure).toBe("PROVIDER_REJECTED");
  });

  it("429 is a refusal — nothing was created", async () => {
    const outcome = await attempt({}, 429);
    expect(outcome.outcome).toBe("REFUSED");
  });

  it("A TIMEOUT IS UNKNOWN, NOT A FAILURE", async () => {
    // The distinction that matters most. A network error means the ANSWER did
    // not come back; it says nothing about whether the store processed it.
    // Calling this a failure is what licenses a retry, and a retry of a write
    // that already succeeded creates a second discount.
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;
    const outcome = await new ShopifyCommerceProvider().createDiscountCode({
      scope: SHOP,
      accessToken: TOKEN,
      parameters: validated(),
    });
    globalThis.fetch = realFetch;
    expect(outcome.outcome).toBe("UNKNOWN");
    expect(outcome.outcome === "UNKNOWN" && outcome.failure).toBe("PROVIDER_UNAVAILABLE");
  });

  it("a 500 is UNKNOWN — the mutation may have run before it failed", async () => {
    const outcome = await attempt({}, 500);
    expect(outcome.outcome).toBe("UNKNOWN");
  });

  it("an unreadable body is UNKNOWN", async () => {
    const outcome = await attempt("<html>502</html>");
    expect(outcome.outcome).toBe("UNKNOWN");
  });

  it("AN ECHO MISMATCH IS UNKNOWN — a confirmation is not a match", async () => {
    // Shopify says yes and returns a 50%-off code where 10% was authorized.
    // Not a success: what exists is not what was approved. Not a failure
    // either: something IS there.
    const wrong = createdOk(validated({ percentageFraction: 0.5 }));
    const outcome = await attempt(wrong);
    expect(outcome.outcome).toBe("UNKNOWN");
    expect(outcome.outcome === "UNKNOWN" && outcome.failure).toBe("ECHO_MISMATCH");
  });

  it("checks EVERY authorized parameter in the echo, not a sample", async () => {
    for (const wrong of [
      validated({ code: "SOMETHINGELSE" }),
      validated({ usageLimit: 999 }),
      validated({ appliesOncePerCustomer: false }),
      validated({ title: "Different title" }),
      validated({ endsAt: new Date(END.getTime() + 86_400_000).toISOString() }),
    ]) {
      const outcome = await attempt(createdOk(wrong));
      expect(outcome.outcome, JSON.stringify(wrong.code)).toBe("UNKNOWN");
    }
  });

  it("accepts a faithful echo", async () => {
    const outcome = await attempt(createdOk());
    expect(outcome.outcome).toBe("APPLIED");
    expect(outcome.outcome === "APPLIED" && outcome.externalId).toBe("gid://shopify/DiscountCodeNode/1");
  });

  it("refuses an invalid shop domain before anything is sent", async () => {
    const calls = stubPages([createdOk()]);
    const outcome = await new ShopifyCommerceProvider().createDiscountCode({
      scope: "169.254.169.254",
      accessToken: TOKEN,
      parameters: validated(),
    });
    globalThis.fetch = realFetch;
    expect(outcome.outcome).toBe("REFUSED");
    expect(calls).toHaveLength(0);
  });

  it("never echoes the token in any failure detail", async () => {
    const outcome = await attempt({ errors: [{ message: `token ${TOKEN} bad` }] });
    const detail = outcome.outcome === "APPLIED" ? "" : outcome.detail;
    expect(detail).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Idempotency, crash, and the refusal to retry
// ---------------------------------------------------------------------------

describe("one authorized action can happen at most once", () => {
  it("SUBMITTED is committed to the database BEFORE the network call", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);

    // Observe the row from inside the fetch — i.e. at the exact moment the
    // request is in flight. This is the crash window.
    let statusDuringCall: string | null = null;
    globalThis.fetch = (async () => {
      const row = await db.commercialAction.findUnique({ where: { id: action.id } });
      statusDuringCall = row?.status ?? null;
      return new Response(JSON.stringify(createdOk()), { status: 200 });
    }) as unknown as typeof fetch;

    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    // If this were written after the call, a crash would leave PLANNED and the
    // action would be freely re-runnable despite possibly having happened.
    expect(statusDuringCall).toBe("SUBMITTED");
  });

  it("A CRASH MID-FLIGHT LEAVES SUBMITTED, AND IS NEVER RETRIED", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);

    // The process dies inside the call: no outcome is ever recorded.
    globalThis.fetch = (async () => {
      throw new Error("container reclaimed");
    }) as unknown as typeof fetch;
    const first = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    expect(first.executed === false && first.status).toBe("UNKNOWN");

    // Now simulate the crash exactly: force the row back to the in-flight state
    // a dead process would have left behind.
    await db.commercialAction.update({ where: { id: action.id }, data: { status: "SUBMITTED" } });

    const calls = stubPages([createdOk()]);
    const retry = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    expect(retry.executed).toBe(false);
    expect(retry.executed === false && retry.status === "REFUSED" && retry.reason).toBe("NOT_PLANNABLE");
    // THE POINT: no second request was made.
    expect(calls).toHaveLength(0);
  });

  it("an UNKNOWN action is refused rather than retried", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    await db.commercialAction.update({ where: { id: action.id }, data: { status: "UNKNOWN" } });

    const calls = stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(result.executed === false && result.status === "REFUSED" && result.reason).toBe("NOT_PLANNABLE");
    expect(calls).toHaveLength(0);
  });

  it("a SUCCEEDED action cannot be run again", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    stubPages([createdOk()]);
    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    const calls = stubPages([createdOk()]);
    const again = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(again.executed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("two concurrent executions send at most one request", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);

    const calls = stubPages([createdOk()]);
    const [a, b] = await Promise.all([
      executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest }),
      executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest }),
    ]);
    globalThis.fetch = realFetch;

    expect([a.executed, b.executed].filter(Boolean)).toHaveLength(1);
    // The compare-and-set is what makes this true, not the check above it.
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("a HOLD action gets zero executor retries", async () => {
    // The executor sets maxAttempts to 0 for anything that is not ALLOW. This
    // pins that behaviour for the one action where a retry would duplicate real
    // external state.
    const source = readFileSync("src/lib/agents/executor.ts", "utf8");
    expect(source).toContain('enforcement.decision === "ALLOW" ? MAX_RETRIES : 0');
    expect(evaluatePolicy({ action: classifyAction("tool", TOOL).classification }).decision).toBe("HOLD");
  });
});

// ---------------------------------------------------------------------------
// Reconciliation — the only way out of an unknown
// ---------------------------------------------------------------------------

describe("an unknown outcome is resolved by asking the store, never by assuming", () => {
  async function unknownAction(owner: User) {
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    globalThis.fetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    const row = await db.commercialAction.findUnique({ where: { id: action.id } });
    expect(row?.status).toBe("UNKNOWN");
    return action;
  }

  it("the store saying YES resolves an unknown to SUCCEEDED", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);

    stubPages([foundOk()]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.observed).toBe(true);
    expect(result.observed && result.exists).toBe(true);
    expect(result.observed && result.matches).toBe(true);
    expect(result.observed && result.status).toBe("SUCCEEDED");
    expect(result.observed && result.resolved).toBe(true);
  });

  it("the store saying NO resolves an unknown to FAILED", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);

    stubPages([{ data: { codeDiscountNodeByCode: null } }]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.observed && result.exists).toBe(false);
    expect(result.observed && result.status).toBe("FAILED");
  });

  it("A MISMATCHED DISCOUNT STAYS UNKNOWN — the write landed, wrongly", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);

    // It exists, but at 50% where 10% was authorized. Calling this SUCCEEDED
    // would make the approval a record of something that did not happen.
    stubPages([foundOk(validated({ percentageFraction: 0.5 }))]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.observed && result.exists).toBe(true);
    expect(result.observed && result.matches).toBe(false);
    expect(result.observed && result.status).toBe("UNKNOWN");
    expect(result.observed && result.resolved).toBe(false);
  });

  it("a failed check resolves nothing — it is not evidence of absence", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);

    stubPages([{ errors: [{ message: "Throttled" }] }]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.observed).toBe(false);
    const row = await db.commercialAction.findUnique({ where: { id: action.id } });
    expect(row?.status).toBe("UNKNOWN");
  });

  it("does not adopt the external id of a discount that does not match", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);
    stubPages([foundOk(validated({ usageLimit: 999 }), 0, "gid://shopify/DiscountCodeNode/999")]);
    await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    const row = await db.commercialAction.findUnique({ where: { id: action.id } });
    expect(row?.externalId).toBeNull();
  });

  it("reports redemptions as a COUNT and never as money", async () => {
    const owner = await createTestUser();
    const action = await unknownAction(owner);
    stubPages([foundOk(validated(), 7)]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.observed && result.redemptions).toBe(7);
    // There is no amount, no currency and no revenue anywhere in this result.
    const keys = Object.keys(result);
    for (const forbidden of ["amount", "amountMinor", "currency", "revenue", "value"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("requires the discount read scope before asking", async () => {
    const owner = await createTestUser();
    await connectWritable(owner, SHOP, [SHOPIFY_WRITE_SCOPE]);
    const { action } = await declaredAction(owner);
    const calls = stubPages([foundOk()]);
    const result = await observeCommercialAction(owner.id, action.id);
    globalThis.fetch = realFetch;
    expect(result.observed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("cannot observe another user's action", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await connectWritable(owner);
    const { action } = await declaredAction(owner);
    const result = await observeCommercialAction(stranger.id, action.id);
    expect(result.observed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evidence, provenance, and the things this must never claim
// ---------------------------------------------------------------------------

describe("a successful write is not revenue", () => {
  it("creates no measurement, no ledger row and no economic result", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest, experiment } = await declaredActionWithExperiment(owner);

    stubPages([createdOk()]);
    const result = await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;
    expect(result.executed).toBe(true);

    // THE CENTRAL NEGATIVE OF THE PHASE. A discount code existing is not a sale,
    // not a measurement, and not money.
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(0);
    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.outcome).toBe("PENDING");
    expect(after?.outcomeRecordedAt).toBeNull();
  });

  it("records durable provenance for what was done", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    // Unique per run: both columns are UNIQUE and the test database persists
    // across runs, so fixed ids would collide on the second execution.
    const runId = `run-${Math.random().toString(36).slice(2)}`;
    const stepId = `step-${Math.random().toString(36).slice(2)}`;
    stubPages([createdOk()]);
    await executeCommercialAction({
      userId: owner.id,
      actionId: action.id,
      contractDigest: digest,
      runId: runId,
      stepId: stepId,
    });
    globalThis.fetch = realFetch;

    const view = await getCommercialAction(owner.id, action.id);
    expect(view?.status).toBe("SUCCEEDED");
    expect(view?.externalId).toBeTruthy();
    expect(view?.submittedAt).toBeTruthy();
    expect(view?.contractDigest).toBe(digest);
    expect(view?.executionRunId).toBe(runId);
    expect(view?.executionStepId).toBe(stepId);
    expect(view?.outcomeUnresolved).toBe(false);

    const events = await db.event.findMany({ where: { userId: owner.id }, orderBy: { createdAt: "asc" } });
    const types = events.map((e) => e.type);
    expect(types).toContain("commerce.action.declared");
    expect(types).toContain("commerce.action.submitted");
    expect(types).toContain("commerce.action.applied");
    // The audit row for a success says in words that no revenue was created,
    // because this is the row someone will later read as proof that it was.
    const applied = events.find((e) => e.type === "commerce.action.applied");
    expect(applied?.payload ?? "").toMatch(/no revenue was created/i);
    expect(applied?.consequential).toBe(true);
  });

  it("never writes the token into an event payload", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    stubPages([createdOk()]);
    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    for (const event of await db.event.findMany({ where: { userId: owner.id } })) {
      expect(event.payload ?? "").not.toContain(TOKEN);
    }
  });

  it("marks an unresolved outcome as unresolved on every read surface", async () => {
    const owner = await createTestUser();
    await connectWritable(owner);
    const { action, digest } = await declaredAction(owner);
    globalThis.fetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await executeCommercialAction({ userId: owner.id, actionId: action.id, contractDigest: digest });
    globalThis.fetch = realFetch;

    const view = await getCommercialAction(owner.id, action.id);
    expect(view?.outcomeUnresolved).toBe(true);
    expect(view?.externalId).toBeNull();
    const listed = (await listCommercialActions(owner.id)).find((a) => a.id === action.id);
    expect(listed?.outcomeUnresolved).toBe(true);
  });

  it("does not leak another user's actions into the list", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await connectWritable(owner);
    const { action } = await declaredAction(owner);
    expect((await listCommercialActions(stranger.id)).map((a) => a.id)).not.toContain(action.id);
  });
});

async function declaredActionWithExperiment(owner: User) {
  const experiment = await db.experiment.create({
    data: { userId: owner.id, hypothesis: `WX ${Math.random().toString(36).slice(2)}` },
  });
  const result = await declareCommercialAction({
    userId: owner.id,
    experimentId: experiment.id,
    externalScope: SHOP,
    parameters: params(),
  });
  if (!result.declared) throw new Error("declare failed");
  return { experiment, action: result.action, digest: result.digest };
}

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

describe("the write surface cannot grow by accident", () => {
  const providerSource = readFileSync("src/lib/integrations/shopifyCommerce.ts", "utf8");
  const portSource = readFileSync("src/lib/integrations/commerce.ts", "utf8");
  const readPortSource = readFileSync("src/lib/integrations/economic.ts", "utf8");
  const executeSource = readFileSync("src/lib/commerce/execute.ts", "utf8");

  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("declares exactly the two intended methods on the write port", () => {
    const body = portSource.slice(portSource.indexOf("interface CommercialWriteProvider"));
    const methods = (body.slice(0, body.indexOf("\n}")).match(/^\s+(\w+)\(/gm) ?? []).map((m) =>
      m.trim().replace("(", "")
    );
    expect(methods.sort()).toEqual(["createDiscountCode", "verifyDiscountCode"]);
  });

  it("contains only the one authorized mutation", () => {
    const mutations = codeOnly(providerSource).match(/mutation\s+(\w+)/g) ?? [];
    expect(mutations).toEqual(["mutation VoxCreateDiscount"]);
  });

  it("touches no order, refund, payment, product or customer write", () => {
    const code = codeOnly(providerSource);
    for (const forbidden of [
      "orderCreate",
      "refundCreate",
      "orderEdit",
      "productCreate",
      "productUpdate",
      "customerCreate",
      "paymentCreate",
      "orderCapture",
      "draftOrderCreate",
      "discountCodeDelete",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("requires only the discount scopes", () => {
    const code = codeOnly(providerSource);
    expect(code).toContain("write_discounts");
    for (const forbidden of ["write_orders", "write_products", "write_customers", "write_payment"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("the READ port still declares only reads", () => {
    // P5-E/P5-F's guarantee, re-asserted here: adding a write must not have
    // leaked into the port that promises it has none.
    const body = readPortSource.slice(readPortSource.indexOf("interface EconomicObservationProvider"));
    const methods = (body.slice(0, body.indexOf("\n}")).match(/^\s+(\w+)\(/gm) ?? []).map((m) =>
      m.trim().replace("(", "")
    );
    expect(methods.sort()).toEqual(["countOrdersInWindow", "sumOrderValueInWindow"]);
  });

  it("the execution service mints no permission and no approval", () => {
    const code = codeOnly(executeSource);
    for (const forbidden of ["grantPermission", "createApprovalGrant", "consumeApprovalGrant"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("the execution service contains no retry", () => {
    const code = codeOnly(executeSource);
    for (const forbidden of ["for (let attempt", "retry", "setTimeout"]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("the provider never writes to the database", () => {
    expect(codeOnly(providerSource)).not.toContain("@/lib/db");
  });

  it("the write outcome's non-success arms carry no external id", () => {
    for (const name of ["interface WriteRefused", "interface WriteUnknown"]) {
      const start = portSource.indexOf(name);
      const arm = portSource.slice(start, portSource.indexOf("\n}", start));
      expect(arm, name).not.toContain("externalId");
    }
  });
});
