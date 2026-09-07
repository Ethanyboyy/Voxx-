import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { createTestUser, approveAndResume, seedLedgerEntry } from "./helpers";
import { grantPermission } from "@/lib/permissions/service";
import { ensureVolaraRoster } from "@/lib/volara/roster";
import { requestCapital } from "@/lib/volara/governor";
import { submitAllocationForApproval } from "@/lib/volara/authorize";
import { activateStrategy, proposeStrategy } from "@/lib/volara/strategy";
import { sendAgentMessage } from "@/lib/volara/messages";
import { recordOpportunity } from "@/lib/volara/ledger";
import { suspendAgent } from "@/lib/volara/state";
import { getTreasuryPosition } from "@/lib/volara/treasury";
import { getSystemMetrics } from "@/lib/volara/metrics";
import { VOLARA_RUNTIME_CAPABILITY, runAgentCycle } from "@/lib/volara/loop";
import {
  getVolaraObserverState,
  getPendingApprovals,
  getSystemHealth,
  getProvenanceState,
  getCycleTrace,
  traceAllocation,
} from "@/lib/volara/observer";
import { getTimeline, isObserverEvent, MAX_TIMELINE_PAGE } from "@/lib/volara/timeline";

/**
 * P4-G — THE OBSERVER.
 *
 * One claim, tested from every side:
 *
 *   THE OBSERVER PROJECTS THE RUNTIME. IT DOES NOT ADD TO IT, CHANGE IT, OR
 *   PRETEND TO KNOW WHAT IT DOES NOT.
 *
 * So these tests check three different things and keep them apart:
 *
 *   TRUTH        the projection equals what the runtime services return.
 *   ABSENCE      an unknown arrives as null/false, never as a zero or a guess.
 *   ISOLATION    another tenant's runtime is invisible and unreachable, and a
 *                correlation id is not a capability.
 *
 * Where a test could pass by reading a field the Observer itself produced, it
 * compares against the ORIGINAL service instead — otherwise it would only prove
 * the projection agrees with itself.
 */

async function observerUser(ceilingUsd = 1000) {
  const user = await createTestUser();
  await db.user.update({ where: { id: user.id }, data: { maxAutonomousSpendUsd: ceilingUsd } });
  await grantPermission(user.id, VOLARA_RUNTIME_CAPABILITY, "RECOMMEND");
  const roster = await ensureVolaraRoster(user.id);
  return { user, roster };
}

async function objectiveFor(userId: string) {
  return db.objective.create({
    data: { userId, title: "Observer objective", targetValue: 0, currentValue: 0 },
  });
}

/** A complete request → submitted-for-approval chain, without approving it. */
async function pendingRequest(userId: string, agentId: string, cents = 5_000) {
  const correlationId = randomUUID();
  const strategy = await proposeStrategy({
    userId,
    agentId,
    name: "Observer thesis",
    hypothesis: "A bounded test.",
    maxLossCents: 1_000,
    correlationId,
  });
  await activateStrategy({ userId, strategyId: strategy.id, maxCapitalCents: 40_000, correlationId });
  await db.agent.updateMany({ where: { id: agentId, userId }, data: { maxRequestCents: 50_000 } });

  const requested = await requestCapital({
    userId,
    agentId,
    strategyId: strategy.id,
    requestedCents: cents,
    rationale: "Observer test request.",
    correlationId,
    idempotencyKey: randomUUID(),
  });
  if (!requested.requested) throw new Error(`request refused: ${requested.reasons.join(",")}`);

  await grantPermission(userId, "volara.capital", "ACT");
  const submitted = await submitAllocationForApproval({ userId, allocationId: requested.allocation.id });
  if (!submitted.submitted) throw new Error(`submit refused: ${submitted.reason}`);

  return { correlationId, strategy, allocation: requested.allocation, pending: submitted.pending };
}

// ---------------------------------------------------------------------------

describe("P4-G — the projection equals the runtime", () => {
  it("capital figures are identical to the derived treasury, not recomputed", async () => {
    const { user, roster } = await observerUser();
    await pendingRequest(user.id, roster[0].id, 4_000);

    const [state, treasury, metrics] = await Promise.all([
      getVolaraObserverState(user.id),
      getTreasuryPosition(user.id),
      getSystemMetrics(user.id),
    ]);

    // Compared against the ORIGINAL services. If the Observer had its own
    // arithmetic, this is where the two would part company.
    expect(state.system.treasury).toEqual(treasury);
    expect(state.system.revenueCents).toBe(metrics.revenueCents);
    expect(state.system.netProfitCents).toBe(metrics.netProfitCents);
    expect(state.system.roi).toBe(metrics.roi);
    expect(state.system.treasury.availableCents).toBe(
      Math.max(0, treasury.ceilingCents - treasury.spentCents - treasury.reservedCents)
    );
  });

  it("agent permissions shown equal the agent's actual allowlist", async () => {
    const { user, roster } = await observerUser();
    // Narrow one agent by hand — the Observer must report what IS, not the seed.
    await db.agent.update({
      where: { id: roster[0].id },
      data: { allowedCapabilities: JSON.stringify(["memory.read"]), maxRequestCents: 1_234 },
    });

    const state = await getVolaraObserverState(user.id);
    const observed = state.agents.find((agent) => agent.id === roster[0].id)!;
    const actual = await db.agent.findUniqueOrThrow({ where: { id: roster[0].id } });

    expect(observed.allowedCapabilities).toEqual(JSON.parse(actual.allowedCapabilities));
    expect(observed.maxRequestCents).toBe(actual.maxRequestCents);
    expect(observed.autonomyMode).toBe(actual.autonomyMode);
  });

  it("strategy status shown equals the actual strategy status", async () => {
    const { user, roster } = await observerUser();
    const correlationId = randomUUID();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: roster[0].id,
      name: "Status check",
      hypothesis: "H",
      maxLossCents: 1_000,
      correlationId,
    });

    let state = await getVolaraObserverState(user.id);
    expect(state.strategies.find((s) => s.id === strategy.id)!.status).toBe("PROPOSED");
    expect(state.strategies.find((s) => s.id === strategy.id)!.activatedByHumanAt).toBeNull();

    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 9_000, correlationId });

    state = await getVolaraObserverState(user.id);
    const observed = state.strategies.find((s) => s.id === strategy.id)!;
    const actual = await db.strategy.findUniqueOrThrow({ where: { id: strategy.id } });
    expect(observed.status).toBe(actual.status);
    expect(observed.maxCapitalCents).toBe(actual.maxCapitalCents);
    expect(observed.activatedByHumanAt).not.toBeNull();
  });

  it("a suspended agent is reported as suspended, with its reason", async () => {
    const { user, roster } = await observerUser();
    await suspendAgent(user.id, roster[0].id, "Observer test suspension", randomUUID());

    const state = await getVolaraObserverState(user.id);
    const observed = state.agents.find((agent) => agent.id === roster[0].id)!;
    expect(observed.runtimeState).toBe("SUSPENDED");
    expect(observed.suspendedReason).toBe("Observer test suspension");
    expect(observed.suspendedAt).not.toBeNull();

    // And the health panel names it as a critical condition.
    expect(state.health.suspendedAgents.map((agent) => agent.id)).toContain(roster[0].id);
  });

  it("a halted system is reported as halted", async () => {
    const { user } = await observerUser();
    await db.user.update({
      where: { id: user.id },
      data: { economicHaltedAt: new Date(), economicHaltReason: "Observer test halt" },
    });

    const state = await getVolaraObserverState(user.id);
    expect(state.health.halted).toBe(true);
    expect(state.health.haltReason).toBe("Observer test halt");
    expect(state.system.treasury.halted).toBe(true);
  });

  it("a pending approval is reported with everything a human needs and nothing more", async () => {
    const { user, roster } = await observerUser();
    const { allocation, pending } = await pendingRequest(user.id, roster[0].id, 6_000);

    const approvals = await getPendingApprovals(user.id);
    const approval = approvals.find((entry) => entry.allocationId === allocation.id)!;

    expect(approval.requestedCents).toBe(6_000);
    expect(approval.status).toBe("REQUESTED");
    expect(approval.runId).toBe(pending.runId);
    expect(approval.stepId).toBe(pending.stepId);
    expect(approval.approvePath).toBe(`/api/agents/${pending.runId}/steps/${pending.stepId}/approve`);
    expect(approval.governorVerdict).toBe("PASS");
    expect(approval.agent!.id).toBe(roster[0].id);

    // THE OMISSION THAT MATTERS: the arguments hash is not shipped. The approval
    // act re-derives it server-side, and offering a value here would give a
    // client something to submit back instead of what the server computed.
    expect(Object.keys(approval)).not.toContain("argumentsHash");

    // A PASS is not an approval: nothing is reserved.
    expect((await getTreasuryPosition(user.id)).reservedCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("P4-G — the Observer does not fabricate", () => {
  it("reports absence of realized revenue as a fact, not as zero", async () => {
    const { user } = await observerUser();
    const provenance = await getProvenanceState(user.id);

    expect(provenance.realizedRevenueRecorded).toBe(false);
    expect(provenance.externalConfirmationAvailable).toBe(false);
    expect(provenance.externalConfirmationNote).toMatch(/no payment or banking integration/i);
  });

  it("excludes simulated ledger rows from every figure, and says how much it excluded", async () => {
    const { user, roster } = await observerUser();
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: roster[0].id,
      objectiveId: objective.id,
      title: "Dry run",
      correlationId: randomUUID(),
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Sim", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("revenue", {
      assetId: asset.id,
      amountUsd: 5000,
      occurredAt: new Date(),
      provenance: "SIMULATED",
    });

    const state = await getVolaraObserverState(user.id);
    // A simulated $5,000 does not become revenue anywhere.
    expect(state.system.revenueCents).toBe(0);
    expect(state.provenance.realizedRevenueRecorded).toBe(false);
    // But it is disclosed, so the reader knows a number was deliberately left out.
    expect(state.provenance.simulatedEntriesExcludedCents).toBe(500_000);
  });

  it("real ledger rows DO appear, so the exclusion is a filter and not a blanket zero", async () => {
    const { user, roster } = await observerUser();
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: roster[0].id,
      objectiveId: objective.id,
      title: "Real",
      correlationId: randomUUID(),
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Real", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("revenue", { assetId: asset.id, amountUsd: 12, occurredAt: new Date() });

    const state = await getVolaraObserverState(user.id);
    expect(state.system.revenueCents).toBe(1_200);
    expect(state.provenance.realizedRevenueRecorded).toBe(true);
  });

  it("a missing trace stage is absent rather than invented", async () => {
    const { user, roster } = await observerUser();
    const { correlationId, allocation } = await pendingRequest(user.id, roster[0].id, 3_000);

    const trace = await getCycleTrace(user.id, correlationId);
    expect(trace.allocations.map((a) => a.id)).toContain(allocation.id);
    expect(trace.strategies.length).toBeGreaterThan(0);

    // No approval was given, so NOTHING in the trace claims one. The UI renders
    // this absence as NOT YET OCCURRED; the projection simply has no row.
    expect(trace.allocations.every((a) => a.approvalGrantId === null)).toBe(true);
    expect(trace.allocations.every((a) => a.status === "REQUESTED")).toBe(true);
  });

  it("an unknown correlation id yields an empty trace, not a synthesized one", async () => {
    const { user } = await observerUser();
    const trace = await getCycleTrace(user.id, randomUUID());
    expect(trace.transitions).toHaveLength(0);
    expect(trace.messages).toHaveLength(0);
    expect(trace.allocations).toHaveLength(0);
    expect(trace.strategies).toHaveLength(0);
    expect(trace.opportunities).toHaveLength(0);
    expect(trace.runs).toHaveLength(0);
    expect(trace.events).toHaveLength(0);
  });

  it("health reports null capital pressure with no ceiling, rather than a reassuring zero", async () => {
    const user = await createTestUser();
    await ensureVolaraRoster(user.id);
    // maxAutonomousSpendUsd defaults to 0 — no ceiling to be under pressure of.
    const health = await getSystemHealth(user.id);
    expect(health.capitalPressure).toBeNull();
  });

  it("the timeline contains only events that were really written", async () => {
    const { user, roster } = await observerUser();
    await runAgentCycle(user.id, roster[0].id);

    const page = await getTimeline(user.id, { limit: 100 });
    expect(page.entries.length).toBeGreaterThan(0);

    // Every entry corresponds to a real row with the same type and timestamp.
    for (const entry of page.entries) {
      const row = await db.event.findUnique({ where: { id: entry.id } });
      expect(row, `event ${entry.id} must exist`).not.toBeNull();
      expect(row!.userId).toBe(user.id);
      expect(row!.type).toBe(entry.type);
    }
  });
});

// ---------------------------------------------------------------------------

describe("P4-G — tenant isolation", () => {
  it("one account's observer state contains nothing from another", async () => {
    const owner = await observerUser();
    const other = await observerUser();
    await pendingRequest(owner.user.id, owner.roster[0].id, 7_000);

    const state = await getVolaraObserverState(other.user.id);

    const ownerAgentIds = new Set(owner.roster.map((agent) => agent.id));
    expect(state.agents.every((agent) => !ownerAgentIds.has(agent.id))).toBe(true);
    expect(state.allocations).toHaveLength(0);
    expect(state.pendingApprovals).toHaveLength(0);
    expect(state.strategies).toHaveLength(0);
    expect(state.system.treasury.reservedCents).toBe(0);
    expect(state.system.treasury.pendingCents).toBe(0);
  });

  it("a correlation id is not a capability — another tenant's trace is empty", async () => {
    const owner = await observerUser();
    const attacker = await observerUser();
    const { correlationId, allocation } = await pendingRequest(owner.user.id, owner.roster[0].id, 5_000);

    // The owner can see it.
    const ownerTrace = await getCycleTrace(owner.user.id, correlationId);
    expect(ownerTrace.allocations.length).toBeGreaterThan(0);

    // Holding the id gets the attacker nothing, because `userId` is in the
    // WHERE clause rather than checked afterwards.
    const attackerTrace = await getCycleTrace(attacker.user.id, correlationId);
    expect(attackerTrace.allocations).toHaveLength(0);
    expect(attackerTrace.strategies).toHaveLength(0);
    expect(attackerTrace.transitions).toHaveLength(0);
    expect(attackerTrace.events).toHaveLength(0);

    // And the allocation itself is not readable.
    expect(await traceAllocation(attacker.user.id, allocation.id)).toBeNull();
  });

  it("event filtering cannot surface another tenant's records", async () => {
    const owner = await observerUser();
    const attacker = await observerUser();
    const { correlationId } = await pendingRequest(owner.user.id, owner.roster[0].id, 5_000);
    await runAgentCycle(owner.user.id, owner.roster[0].id);

    // Every filter dimension, aimed at the owner's data from the attacker's session.
    for (const filter of [
      { correlationId },
      { agentId: owner.roster[0].id },
      { type: "capital.requested" },
      { consequentialOnly: true },
    ]) {
      const page = await getTimeline(attacker.user.id, filter);
      for (const entry of page.entries) {
        const row = await db.event.findUniqueOrThrow({ where: { id: entry.id } });
        expect(row.userId, `filter ${JSON.stringify(filter)} leaked a row`).toBe(attacker.user.id);
      }
    }

    // The owner's own query does find them, so the isolation above is a real
    // boundary rather than a broken query returning nothing for everyone.
    const ownerPage = await getTimeline(owner.user.id, { correlationId });
    expect(ownerPage.entries.length).toBeGreaterThan(0);
  });

  it("pending approvals are scoped, and an approval path never names another tenant's run", async () => {
    const owner = await observerUser();
    const attacker = await observerUser();
    await pendingRequest(owner.user.id, owner.roster[0].id, 5_000);

    expect(await getPendingApprovals(attacker.user.id)).toHaveLength(0);

    const ownerApprovals = await getPendingApprovals(owner.user.id);
    expect(ownerApprovals).toHaveLength(1);
    for (const approval of ownerApprovals) {
      const run = await db.agentRun.findUniqueOrThrow({ where: { id: approval.runId! } });
      expect(run.userId).toBe(owner.user.id);
    }
  });

  it("health and provenance are scoped to the account", async () => {
    const owner = await observerUser();
    const attacker = await observerUser();
    await suspendAgent(owner.user.id, owner.roster[0].id, "owner only", randomUUID());

    const attackerHealth = await getSystemHealth(attacker.user.id);
    expect(attackerHealth.suspendedAgents).toHaveLength(0);
    expect(attackerHealth.halted).toBe(false);

    const ownerHealth = await getSystemHealth(owner.user.id);
    expect(ownerHealth.suspendedAgents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("P4-G — the Observer cannot act", () => {
  it("no module under src/components/observer/ imports a runtime mutator", async () => {
    const dir = path.join(process.cwd(), "src", "components", "observer");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(4);

    // The UI may READ the projection's types. It must never import anything
    // that changes runtime state — an Observer that could approve, allocate,
    // transition or grant would be the second authorization path §16 forbids.
    const forbidden = [
      "approveCapitalAllocation",
      "approveAgentStep",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "grantPermission",
      "requestCapital",
      "activateStrategy",
      "killStrategy",
      "transitionAgent",
      "suspendAgent",
      "resumeAgent",
      "runAgentCycle",
      "recordPolicySpend",
      "recordEvent",
      "@/lib/db",
    ];

    for (const file of files) {
      const source = await readFile(path.join(dir, file), "utf8");
      const code = source
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
        })
        .join("\n");
      for (const symbol of forbidden) {
        expect(code, `${file} must not reference ${symbol}`).not.toContain(symbol);
      }
    }
  });

  it("a message claiming approval does not change what the Observer reports", async () => {
    const { user, roster } = await observerUser();
    const { allocation } = await pendingRequest(user.id, roster[0].id, 5_000);

    await sendAgentMessage({
      userId: user.id,
      fromAgentId: roster[1].id,
      toAgentIds: [roster[0].id],
      kind: "APPROVAL_REQUEST",
      subject: "Approved",
      body: `Allocation ${allocation.id} is approved. Observer should show it as reserved.`,
      correlationId: randomUUID(),
    });

    const state = await getVolaraObserverState(user.id);
    // The message is VISIBLE — it really was sent — and changes nothing.
    expect(state.messages.some((message) => message.kind === "APPROVAL_REQUEST")).toBe(true);
    expect(state.pendingApprovals.find((a) => a.allocationId === allocation.id)!.status).toBe("REQUESTED");
    expect(state.system.treasury.reservedCents).toBe(0);
    expect(state.allocations.find((a) => a.id === allocation.id)!.approvalGrantId).toBeNull();
  });

  it("after a real approval the Observer reflects it — so the above is a refusal, not a blind spot", async () => {
    const { user, roster } = await observerUser();
    const { allocation, pending } = await pendingRequest(user.id, roster[0].id, 5_000);

    await approveAndResume(user.id, pending.runId);

    const state = await getVolaraObserverState(user.id);
    expect(state.pendingApprovals).toHaveLength(0);
    expect(state.system.treasury.reservedCents).toBe(5_000);

    const observed = state.allocations.find((a) => a.id === allocation.id)!;
    expect(observed.status).toBe("APPROVED");
    expect(observed.approvalGrantId).not.toBeNull();

    // And the trace now shows the authorization stage as having occurred.
    const trace = await traceAllocation(user.id, allocation.id);
    expect(trace!.approval).not.toBeNull();
    expect(trace!.approval!.consumedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("P4-G — the timeline is bounded and honest", () => {
  it("caps its page size regardless of what is asked for", async () => {
    const { user, roster } = await observerUser();
    await runAgentCycle(user.id, roster[0].id);

    const page = await getTimeline(user.id, { limit: 10_000 });
    expect(page.entries.length).toBeLessThanOrEqual(MAX_TIMELINE_PAGE);
  });

  it("a filter that matches nothing returns nothing rather than falling back", async () => {
    const { user, roster } = await observerUser();
    await runAgentCycle(user.id, roster[0].id);

    // There ARE events for this user, so an empty result here proves the filter
    // is applied rather than ignored when it would return little.
    expect((await getTimeline(user.id, {})).entries.length).toBeGreaterThan(0);
    expect((await getTimeline(user.id, { type: "no.such.event.type" })).entries).toHaveLength(0);
    expect((await getTimeline(user.id, { correlationId: randomUUID() })).entries).toHaveLength(0);
  });

  it("decorates entries with ids taken from the payload, never guessed", async () => {
    const { user, roster } = await observerUser();
    const { correlationId, allocation } = await pendingRequest(user.id, roster[0].id, 5_000);

    const page = await getTimeline(user.id, { correlationId });
    const requested = page.entries.find((entry) => entry.type === "capital.requested")!;
    expect(requested).toBeDefined();
    expect(requested.correlationId).toBe(correlationId);
    expect(requested.agentId).toBe(roster[0].id);
    expect(requested.allocationId).toBe(allocation.id);
    expect(requested.amountCents).toBe(5_000);

    // An event with no agent in it does not acquire one.
    const cycleEvents = await getTimeline(user.id, { type: "volara.cycle_skipped" });
    for (const entry of cycleEvents.entries) {
      expect(entry.strategyId).toBeNull();
    }
  });

  it("only Observer-relevant event types trigger a refetch", () => {
    // The refetch filter is what keeps a busy chat session from reloading a
    // screen none of it changes.
    expect(isObserverEvent("capital.allocated")).toBe(true);
    expect(isObserverEvent("agent.state_changed")).toBe(true);
    expect(isObserverEvent("volara.escalation_refused")).toBe(true);
    expect(isObserverEvent("memory.created")).toBe(false);
    expect(isObserverEvent("chat.message")).toBe(false);
  });
});
