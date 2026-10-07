/**
 * [P6-G] LIVE READINESS — tests for the preflight, and for the boundary it sits on.
 *
 * P6-F left the commercial intervention path architecturally complete and
 * credential-unexercised. P6-G's job was to make it safely runnable and then
 * run it. It is runnable; it did not run, because no live Shopify access exists
 * in this environment by any route.
 *
 * So these tests cover the genuinely new code — the preflight — and assert the
 * properties that matter about it:
 *
 *   Does it name the EARLIEST unmet precondition, not all of them?
 *   Does it ever leak the token?
 *   Does it make an external call?
 *   Does it authorize, write, or execute anything?
 *   Does "waiting for a human" read as success rather than failure?
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { liveReadiness, LIVE_WRITE_CAPABILITY } from "@/lib/commerce/liveReadiness";
import { dispatchIntervention } from "@/lib/commerce/dispatch";
import { resumeAgentRun } from "@/lib/agents/service";
import { connectShopifyStore } from "@/lib/connections/shopify";
import { grantAccess } from "@/lib/connections/service";
import { declareCommercialAction } from "@/lib/commerce/execute";
import { SHOPIFY_WRITE_SCOPE } from "@/lib/integrations/shopifyCommerce";
import { grantPermission } from "@/lib/permissions/service";
import { createApprovalGrant } from "@/lib/policy/approvals";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

const SHOP = "vox-readiness.myshopify.com";
/** An obvious fixture, never a real credential. */
const TOKEN = "shpat_readinessfixture0123";
const TOOL = "commerce.create_discount_code";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubOnce(body: unknown, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const okCount = { data: { ordersCount: { count: 0, precision: "EXACT" } } };

async function connect(owner: User, scopes: string[] = [SHOPIFY_WRITE_SCOPE, "read_orders"]) {
  stubOnce(okCount);
  const result = await connectShopifyStore({
    userId: owner.id,
    shopDomain: SHOP,
    accessToken: TOKEN,
    declaredWriteScopes: scopes,
  });
  globalThis.fetch = realFetch;
  if (!result.connected) throw new Error(`fixture connect failed: ${result.reason}`);
}

function params() {
  return {
    code: "VOXLIVE10",
    title: "VOX first live experiment",
    percentageFraction: 0.1,
    startsAt: new Date("2026-11-01T00:00:00.000Z").toISOString(),
    endsAt: new Date("2026-11-08T00:00:00.000Z").toISOString(),
    usageLimit: 25,
    appliesOncePerCustomer: true,
  };
}

async function declaredIntervention(owner: User) {
  const experiment = await db.experiment.create({
    data: { userId: owner.id, hypothesis: `live ${Math.random().toString(36).slice(2)}` },
  });
  const result = await declareCommercialAction({
    userId: owner.id,
    experimentId: experiment.id,
    externalScope: SHOP,
    parameters: params(),
  });
  if (!result.declared) throw new Error(`fixture declare failed: ${result.reason}`);
  return { experiment, action: result.action, digest: result.digest };
}

/** A faithful Shopify create response. */
function createdOk(id = "gid://shopify/DiscountCodeNode/1") {
  const p = params();
  return {
    data: {
      discountCodeBasicCreate: {
        codeDiscountNode: {
          id,
          codeDiscount: {
            title: p.title,
            status: "ACTIVE",
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            usageLimit: p.usageLimit,
            appliesOncePerCustomer: p.appliesOncePerCustomer,
            codes: { nodes: [{ code: p.code }] },
            customerGets: { value: { percentage: p.percentageFraction }, items: { allItems: true } },
          },
        },
        userErrors: [],
      },
    },
  };
}

/**
 * The WHOLE operator sequence: dispatch, park, approve, resume.
 *
 * Deliberately not a shortcut past the gate. The grant is minted by
 * `createApprovalGrant()` against the step the dispatch actually parked, with
 * the arguments the dispatch actually built — so if the dispatch composed the
 * wrong arguments, `matchesApproval()` rejects at resume and this fixture
 * fails rather than papering over it.
 */
async function executeAuthorized(owner: User, actionId: string, digest: string) {
  globalThis.fetch = (async () => {
    throw new Error("no store call expected before approval");
  }) as unknown as typeof fetch;
  const parked = await dispatchIntervention(owner.id, actionId);
  globalThis.fetch = realFetch;
  if (!parked.dispatched) throw new Error("fixture dispatch failed");

  await createApprovalGrant({
    userId: owner.id,
    registry: "tool",
    actionId: TOOL,
    parsedArguments: { actionId, contractDigest: digest },
    policyDecision: "HOLD",
    capability: LIVE_WRITE_CAPABILITY,
    requiredLevel: "ACT",
    targetType: "AgentStep",
    targetId: parked.stepId,
  });

  const calls = stubOnce(createdOk());
  await resumeAgentRun(owner.id, parked.runId);
  globalThis.fetch = realFetch;

  const row = await db.commercialAction.findUniqueOrThrow({ where: { id: actionId } });
  return { runId: parked.runId, stepId: parked.stepId, calls, actionStatus: row.status, externalId: row.externalId };
}

// ---------------------------------------------------------------------------
// The six states, in the order a real operator meets them
// ---------------------------------------------------------------------------

describe("the preflight names the earliest unmet precondition", () => {
  it("CREDENTIAL_MISSING with no store connected", async () => {
    // The state this repository is in.
    const owner = await createTestUser();
    const readiness = await liveReadiness(owner.id);

    expect(readiness.state).toBe("CREDENTIAL_MISSING");
    expect(readiness.shopDomain).toBeNull();
    expect(readiness.pendingAction).toBeNull();
    expect(readiness.nextStep).toMatch(/connect one store/i);
    // And it says what makes a connection real, rather than just "connect".
    expect(readiness.nextStep).toMatch(/authenticated read/i);
  });

  it("CREDENTIAL_MISSING when the connection exists and is not CONNECTED", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await db.connection.updateMany({
      where: { userId: owner.id, service: "SHOPIFY" },
      data: { status: "REVOKED" },
    });

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("CREDENTIAL_MISSING");
    expect(readiness.stages.find((s) => s.stage === "connection")!.met).toBe(false);
    expect(readiness.stages.find((s) => s.stage === "connection")!.detail).toMatch(/REVOKED/);
  });

  it("CREDENTIAL_INVALID when read access was withdrawn", async () => {
    // A connection that exists and whose credential cannot be used. Reported
    // through the SAME resolver the observation path uses, so the diagnostic
    // cannot be more optimistic than the code that reads the store.
    const owner = await createTestUser();
    await connect(owner);
    await db.connection.updateMany({
      where: { userId: owner.id, service: "SHOPIFY" },
      data: { readEnabled: false },
    });

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("CREDENTIAL_INVALID");
    expect(readiness.nextStep).toMatch(/read access/i);
  });

  it("PERMISSION_INSUFFICIENT until the capability is granted at ACT", async () => {
    const owner = await createTestUser();
    await connect(owner);

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("PERMISSION_INSUFFICIENT");
    expect(readiness.shopDomain).toBe(SHOP);
    expect(readiness.writeScopeDeclared).toBe(true);
    const capability = readiness.stages.find((s) => s.stage === "capability")!;
    expect(capability.met).toBe(false);
    // It says the level is the never-granted default, which is the whole
    // reason an account that has granted nothing cannot reach the write tool.
    expect(capability.detail).toMatch(/default, never granted/i);
    expect(readiness.nextStep).toContain(LIVE_WRITE_CAPABILITY);
  });

  it("PERMISSION_INSUFFICIENT when the write scope was never declared", async () => {
    // Granted capability, read-only connection. The write path refuses before
    // sending anything, and the preflight says so instead of looking ready.
    const owner = await createTestUser();
    await connect(owner, ["read_orders"]);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("PERMISSION_INSUFFICIENT");
    expect(readiness.writeScopeDeclared).toBe(false);
    expect(readiness.stages.find((s) => s.stage === "capability")!.met).toBe(true);
    expect(readiness.nextStep).toContain(SHOPIFY_WRITE_SCOPE);
  });

  it("LIVE_CONNECTED when the path is open and nothing is queued on it", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("LIVE_CONNECTED");
    expect(readiness.pendingAction).toBeNull();
    expect(readiness.nextStep).toMatch(/declare one bounded intervention/i);
    expect(readiness.stages.every((s) => s.stage === "intervention" || s.met)).toBe(true);
  });

  it("AUTHORIZATION_REQUIRED with a frozen intervention and no approval", async () => {
    // THE CORRECT RESTING STATE of a properly gated system: one bounded action
    // prepared, waiting for a person. Reaching it is success.
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { experiment, action } = await declaredIntervention(owner);

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("AUTHORIZATION_REQUIRED");
    expect(readiness.pendingAction).toMatchObject({
      actionId: action.id,
      experimentId: experiment.id,
      code: "VOXLIVE10",
      status: "PLANNED",
    });
    expect(readiness.nextStep).toMatch(/binds the hash of the validated arguments/i);
  });

  it("READY_FOR_LIVE_EXECUTION only when every stage is met", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action, digest } = await declaredIntervention(owner);
    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: digest },
      policyDecision: "HOLD",
      capability: LIVE_WRITE_CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: "step-fixture",
    });

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("READY_FOR_LIVE_EXECUTION");
    expect(readiness.stages.every((s) => s.met)).toBe(true);
    // It says plainly that the next execution changes a real store.
    expect(readiness.nextStep).toMatch(/real change to a real store/i);
    expect(readiness.nextStep).toContain(SHOP);
    expect(readiness.nextStep).toMatch(/Nothing here performs it/i);
  });

  it("the grant's MATCH is still decided at execution, not here", async () => {
    // A grant for different arguments satisfies the preflight's presence check
    // and is rejected by `matchesApproval()` at execution. Re-deciding the
    // match here would be a second answer to the one question the
    // authorization boundary exists to answer.
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action } = await declaredIntervention(owner);
    await createApprovalGrant({
      userId: owner.id,
      registry: "tool",
      actionId: TOOL,
      parsedArguments: { actionId: action.id, contractDigest: "f".repeat(64) },
      policyDecision: "HOLD",
      capability: LIVE_WRITE_CAPABILITY,
      requiredLevel: "ACT",
      targetType: "AgentStep",
      targetId: "step-fixture-2",
    });

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("READY_FOR_LIVE_EXECUTION");
    expect(readiness.stages.find((s) => s.stage === "authorization")!.detail).toMatch(
      /decided at execution by matchesApproval/i
    );
  });
});

// ---------------------------------------------------------------------------
// The properties that make it safe to run
// ---------------------------------------------------------------------------

describe("the preflight is safe to call", () => {
  it("NEVER RETURNS THE TOKEN, IN ANY STATE", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    await declaredIntervention(owner);

    const serialized = JSON.stringify(await liveReadiness(owner.id));
    // Not the token, not a prefix of it, not the Shopify token marker.
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("shpat_");
    expect(serialized).not.toContain(TOKEN.slice(0, 12));
    // The shop domain IS returned: it is public, and an operator has to see
    // which store is about to be written to.
    expect(serialized).toContain(SHOP);
  });

  it("MAKES NO EXTERNAL CALL", async () => {
    // A readiness check that phoned Shopify would itself be the live request
    // it is meant to be checking the preconditions for.
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    await declaredIntervention(owner);

    const calls = stubOnce(okCount);
    await liveReadiness(owner.id);
    globalThis.fetch = realFetch;
    expect(calls).toHaveLength(0);
  });

  it("WRITES NOTHING AND AUTHORIZES NOTHING", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action } = await declaredIntervention(owner);

    const before = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    const grantsBefore = await db.approvalGrant.count({ where: { userId: owner.id } });
    const eventsBefore = await db.event.count({ where: { userId: owner.id } });

    await liveReadiness(owner.id);
    await liveReadiness(owner.id);

    const after = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(after.status).toBe(before.status);
    expect(after.externalId).toBeNull();
    expect(after.submittedAt).toBeNull();
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(grantsBefore);
    // Not even an audit event: a read that records nothing is a read.
    expect(await db.event.count({ where: { userId: owner.id } })).toBe(eventsBefore);
  });

  it("imports no executor, grant minter or provider", () => {
    const source = readFileSync("src/lib/commerce/liveReadiness.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = (code.match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
    for (const forbidden of [
      "executeCommercialAction",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "grantPermission",
      "enforceCapability",
      "executeRun",
      "getCommercialWriteProvider",
      "bindObservationSubject",
    ]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
    expect(code).not.toContain("fetch(");
  });

  it("is scoped per user", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");

    const other = await createTestUser();
    const readiness = await liveReadiness(other.id);
    // Another account's connected store is invisible.
    expect(readiness.state).toBe("CREDENTIAL_MISSING");
    expect(readiness.shopDomain).toBeNull();
  });

  it("carries the limits that hold in every state", async () => {
    const owner = await createTestUser();
    const readiness = await liveReadiness(owner.id);
    const caveats = readiness.caveats.join(" ");
    expect(caveats).toMatch(/gross order value is not profit/i);
    expect(caveats).toMatch(/redemptions, not evidence the code caused/i);
    // The declared-not-proven write scope, stated rather than buried.
    expect(caveats).toMatch(/declared by the operator, not proven/i);
  });
});

// ---------------------------------------------------------------------------
// The dispatch surface: the second thing P6-G added, and the narrower one
// ---------------------------------------------------------------------------
//
// Before P6-G the only HTTP route into the executor was `POST /api/agents`,
// which hands an objective to a PLANNER. So reaching the write tool through the
// application meant hoping a model chose `commerce.create_discount_code` and
// typed the right action id and the right 64-hex digest into it. The P6-F tests
// build the run by hand, which is exactly why they could run and the
// application could not.
//
// What matters about the fix is that it adds NO authority. These tests assert
// that, rather than re-asserting the gates P6-F already covers.

describe("dispatching a declared intervention adds no authority", () => {
  it("PARKS WITHOUT A GRANT AND SENDS NOTHING", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action } = await declaredIntervention(owner);

    // A fetch stub that FAILS the test if it is reached. The assertion is not
    // "no discount was created" — it is that the store was never spoken to.
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      throw new Error("the store must not be contacted without an approval");
    }) as unknown as typeof fetch;

    const result = await dispatchIntervention(owner.id, action.id);
    globalThis.fetch = realFetch;

    expect(result.dispatched).toBe(true);
    if (!result.dispatched) throw new Error("unreachable");
    // Waiting for a person IS the successful outcome of a first dispatch.
    expect(result.runStatus).toBe("WAITING_FOR_PERMISSION");
    expect(result.actionStatus).toBe("PLANNED");
    expect(result.externalId).toBeNull();
    expect(calls).toEqual([]);

    // And the row is untouched: no submission, no external identity.
    const row = await db.commercialAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(row.submittedAt).toBeNull();
    expect(row.externalId).toBeNull();
  });

  it("THE STEP'S ARGUMENTS COME FROM THE FROZEN ROW, NOT FROM THE CALLER", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action, digest } = await declaredIntervention(owner);

    globalThis.fetch = (async () => {
      throw new Error("no store call expected");
    }) as unknown as typeof fetch;
    const result = await dispatchIntervention(owner.id, action.id);
    globalThis.fetch = realFetch;
    if (!result.dispatched) throw new Error("expected a dispatch");

    const step = await db.agentStep.findUniqueOrThrow({ where: { id: result.stepId } });
    expect(step.toolName).toBe(TOOL);
    // The digest is in the arguments because the grant binds the hash OF the
    // arguments — so a parameter edited after approval stops matching.
    expect(JSON.parse(step.input as string)).toEqual({
      actionId: action.id,
      contractDigest: digest,
    });
  });

  it("refuses a second dispatch of the same action", async () => {
    const owner = await createTestUser();
    await connect(owner);
    await grantPermission(owner.id, LIVE_WRITE_CAPABILITY, "ACT");
    const { action, digest } = await declaredIntervention(owner);

    // Approve and execute once, through the existing gated path.
    const first = await executeAuthorized(owner, action.id, digest);
    expect(first.actionStatus).toBe("SUCCEEDED");

    const second = await dispatchIntervention(owner.id, action.id);
    expect(second.dispatched).toBe(false);
    if (second.dispatched) throw new Error("unreachable");
    expect(second.reason).toBe("ALREADY_DISPATCHED");
  });

  it("REFUSES TO DISPATCH AN ACTION WHOSE OUTCOME IS UNKNOWN", async () => {
    const owner = await createTestUser();
    await connect(owner);
    const { action } = await declaredIntervention(owner);
    // An action whose first attempt left it ambiguous. Re-dispatching it would
    // be acting as though nothing exists, which VOX does not know.
    await db.commercialAction.update({
      where: { id: action.id },
      data: { status: "UNKNOWN", submittedAt: new Date() },
    });

    const result = await dispatchIntervention(owner.id, action.id);
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error("unreachable");
    expect(result.reason).toBe("NOT_PLANNABLE");
    expect(result.detail).toMatch(/UNKNOWN/);
    expect(result.detail).toMatch(/ask the store/i);
  });

  it("the dispatch module opens no second authorization path", () => {
    const source = readFileSync("src/lib/commerce/dispatch.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "executeCommercialAction",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "grantPermission",
      "enforceCapability",
      "evaluatePolicy",
      "approveAgentStep",
      "getCommercialWriteProvider",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // No external call of its own. The tool makes the one call there is.
    expect(code).not.toContain("fetch(");
  });

  it("is scoped per user", async () => {
    const owner = await createTestUser();
    await connect(owner);
    const { action } = await declaredIntervention(owner);

    const other = await createTestUser();
    const result = await dispatchIntervention(other.id, action.id);
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error("unreachable");
    expect(result.reason).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// The runbook's own ordering, under test
// ---------------------------------------------------------------------------

describe("the documented operator sequence is the one that works", () => {
  it("GRANT ACCESS FIRST, THEN CONNECT — the other order breaks the connection", async () => {
    // The trap, stated plainly because it is not guessable: `grantAccess()` is
    // the Connections Hub path, and the Hub's registered SHOPIFY provider is
    // the stub, so it always finishes by setting the connection to ERROR. The
    // real Shopify path is `connectShopifyStore()`. Calling them in the wrong
    // order leaves a store that verified against the live API sitting in ERROR.
    const owner = await createTestUser();
    await connect(owner);
    expect((await liveReadiness(owner.id)).state).toBe("PERMISSION_INSUFFICIENT");

    await grantAccess(owner.id, "SHOPIFY", { read: true, write: true });
    // The capability IS now granted — and the connection is wrecked.
    const wrecked = await db.connection.findFirstOrThrow({ where: { userId: owner.id, service: "SHOPIFY" } });
    expect(wrecked.status).toBe("ERROR");
    const after = await liveReadiness(owner.id);
    expect(after.state).toBe("CREDENTIAL_MISSING");
    expect(after.stages[0].detail).toMatch(/is ERROR, not CONNECTED/);
  });

  it("the documented order reaches LIVE_CONNECTED", async () => {
    const owner = await createTestUser();
    // 1. Grant read at RECOMMEND and write at ACT through the real permission
    //    system. The ERROR this leaves on the row is the stub provider, and the
    //    next step overwrites it.
    await grantAccess(owner.id, "SHOPIFY", { read: true, write: true });
    // 2. Connect the real store, declaring the write scope.
    await connect(owner);

    const readiness = await liveReadiness(owner.id);
    expect(readiness.state).toBe("LIVE_CONNECTED");
    expect(readiness.shopDomain).toBe(SHOP);
    expect(readiness.writeScopeDeclared).toBe(true);
    // `connectShopifyStore()` resets the Hub's writeEnabled flag, and that is
    // not what authorizes the write — the capability and the credential's
    // granted scope are. Asserted so a future change to either cannot quietly
    // make the documented order stop working.
    const row = await db.connection.findFirstOrThrow({ where: { userId: owner.id, service: "SHOPIFY" } });
    expect(row.writeEnabled).toBe(false);
    expect(row.status).toBe("CONNECTED");
  });
});
