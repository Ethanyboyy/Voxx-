import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createTestUser, approveAndResume, seedLedgerEntry } from "./helpers";
import { grantPermission } from "@/lib/permissions/service";
import { ensureVolaraRoster } from "@/lib/volara/roster";
import { requestCapital, rejectCapitalAllocation } from "@/lib/volara/governor";
import { submitAllocationForApproval } from "@/lib/volara/authorize";
import { activateStrategy, proposeStrategy } from "@/lib/volara/strategy";
import { recordOpportunity, settleOpportunity } from "@/lib/volara/ledger";
import { sendAgentMessage } from "@/lib/volara/messages";
import { promoteStrategyOutcome } from "@/lib/volara/learning";
import { traceAllocation, getCycleTrace } from "@/lib/volara/observer";
import { rejectAgentStep } from "@/lib/policy/step-approvals";
import { getTreasuryPosition } from "@/lib/volara/treasury";
import { VOLARA_RUNTIME_CAPABILITY } from "@/lib/volara/loop";
import { recordPolicySpend } from "@/lib/economic/spend";

/**
 * P4-F — TRACEABILITY AND POLICY INTEGRATION.
 *
 * §18 asks for forensic reconstruction of the whole chain:
 *
 *   objective → opportunity → strategy → agent run → capital request →
 *   governor decision → policy decision → authorization → execution →
 *   economic record → learning
 *
 * The first test below walks that chain end to end for real and then asks the
 * observer to reassemble it, which is the only honest way to check that the
 * links exist rather than that the fields are populated.
 *
 * The rest re-test P4-D/P4-E's guarantees THROUGH the new runtime, because
 * "enforcement still holds" is a claim about the new paths, not about the old
 * ones the earlier phases already covered.
 */

async function chainSetup() {
  const user = await createTestUser();
  await db.user.update({ where: { id: user.id }, data: { maxAutonomousSpendUsd: 500 } });
  await grantPermission(user.id, VOLARA_RUNTIME_CAPABILITY, "RECOMMEND");
  await grantPermission(user.id, "volara.capital", "ACT");
  const roster = await ensureVolaraRoster(user.id);
  await db.agent.updateMany({ where: { userId: user.id }, data: { maxRequestCents: 20_00 } });
  const objective = await db.objective.create({
    data: { userId: user.id, title: "Reach first revenue", targetValue: 100, currentValue: 0 },
  });
  return { user, roster, objective };
}

describe("P4-F — the full objective → economic result chain", () => {
  it("reconstructs every link from one correlation id and one allocation", async () => {
    const { user, roster, objective } = await chainSetup();
    const operator = roster.find((agent) => agent.role === "OPERATOR")!;
    const analyst = roster.find((agent) => agent.role === "ANALYST")!;
    const correlationId = randomUUID();

    // 1. OPPORTUNITY, discovered by a named agent, against a real objective.
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: operator.id,
      objectiveId: objective.id,
      title: "Newsletter sponsorship",
      category: "content",
      requiredCapitalCents: 15_00,
      expectedRevenueCents: 60_00,
      probabilityOfSuccess: 0.4,
      maxLossCents: 15_00,
      evidence: [{ type: "SOURCED", text: "Two comparable slots sold at this rate." }],
      correlationId,
    });

    // 2. Another agent CHALLENGES it — the society leaving a record of dissent.
    await sendAgentMessage({
      userId: user.id,
      fromAgentId: analyst.id,
      kind: "CHALLENGE",
      subject: "Probability basis",
      body: "0.4 is stated without a source. What is it from?",
      opportunityId: opportunity.id,
      correlationId,
    });

    // 3. STRATEGY, drafted then activated by a human.
    const draft = await proposeStrategy({
      userId: user.id,
      agentId: operator.id,
      name: "Sell one sponsorship slot",
      hypothesis: "One slot sells at the comparable rate.",
      opportunityId: opportunity.id,
      maxLossCents: 15_00,
      correlationId,
    });
    const activated = await activateStrategy({
      userId: user.id,
      strategyId: draft.id,
      maxCapitalCents: 20_00,
      correlationId,
    });
    expect(activated.activated).toBe(true);

    // 4. CAPITAL REQUEST + 5. GOVERNOR DECISION.
    const requested = await requestCapital({
      userId: user.id,
      agentId: operator.id,
      strategyId: draft.id,
      opportunityId: opportunity.id,
      requestedCents: 15_00,
      rationale: "One slot, bounded at the stated downside.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    expect(requested.requested).toBe(true);
    if (!requested.requested) return;
    expect(requested.verdict.verdict).toBe("PASS");

    // 6. AGENT RUN + 7. POLICY DECISION + 8. AUTHORIZATION.
    const submitted = await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id });
    expect(submitted.submitted).toBe(true);
    if (!submitted.submitted) return;
    // The policy decision a human was shown is HOLD, and the hash is the
    // server's own — not something the client supplied.
    expect(submitted.pending.policyDecision).toBe("HOLD");
    expect(submitted.pending.requiredLevel).toBe("ACT");
    await approveAndResume(user.id, submitted.pending.runId);

    // 9. EXECUTION: the reservation actually happened.
    const allocation = await db.capitalAllocation.findUniqueOrThrow({ where: { id: requested.allocation.id } });
    expect(allocation.status).toBe("APPROVED");

    // 10. ECONOMIC RECORD, through the real spend path.
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Sponsorship", category: "CONTENT_ASSET", opportunityId: opportunity.id },
    });
    await recordPolicySpend(user.id, { assetId: asset.id, amountUsd: 15, notes: "Slot production cost" });
    await seedLedgerEntry("revenue", { assetId: asset.id, amountUsd: 60, occurredAt: new Date() });

    // 11. OUTCOME, derived — never asserted.
    const settled = await settleOpportunity({ userId: user.id, opportunityId: opportunity.id, correlationId });
    expect(settled).toEqual({ settled: true, status: "COMPLETED", realizedProfitCents: 4_500 });

    // 12. LEARNING, from a settled strategy with real ledger rows.
    await db.strategy.update({ where: { id: draft.id }, data: { status: "COMPLETED" } });
    const learned = await promoteStrategyOutcome({ userId: user.id, strategyId: draft.id, correlationId });
    expect(learned.promoted).toBe(true);

    // ---- NOW RECONSTRUCT IT, from the allocation outward. ----
    const trace = await traceAllocation(user.id, allocation.id);
    expect(trace).not.toBeNull();
    if (!trace) return;

    expect(trace.agent!.name).toBe(operator.name);
    expect(trace.strategy!.id).toBe(draft.id);
    expect(trace.opportunity!.id).toBe(opportunity.id);
    expect(trace.governorVerdict).toBe("PASS");
    expect(trace.decisionRecord).toMatchObject({ whyRequested: expect.any(String), approvedCents: 15_00 });
    expect(trace.positionSnapshot).not.toBeNull();

    // The AUTHORIZATION half, with what the grant was actually bound to.
    expect(trace.approval).not.toBeNull();
    expect(trace.approval!.actionId).toBe("volara.allocate_capital");
    expect(trace.approval!.policyDecision).toBe("HOLD");
    expect(trace.approval!.consumedAt).not.toBeNull();
    expect(trace.approval!.targetType).toBe("AgentStep");
    expect(trace.approval!.targetId).toBe(submitted.pending.stepId);

    // The RUN and its step.
    expect(trace.run!.id).toBe(submitted.pending.runId);
    expect(trace.run!.steps[0].toolName).toBe("volara.allocate_capital");

    // The LEDGER rows the money actually landed in.
    expect(trace.ledger.revenue).toHaveLength(1);
    expect(trace.ledger.expenses).toHaveLength(1);
    expect(trace.ledger.expenses[0].amountCents).toBe(15_00);

    // ---- AND from the correlation id, which spans the whole cycle. ----
    const cycle = await getCycleTrace(user.id, correlationId);
    expect(cycle.opportunities.map((row) => row.id)).toContain(opportunity.id);
    expect(cycle.strategies.map((row) => row.id)).toContain(draft.id);
    expect(cycle.allocations.map((row) => row.id)).toContain(allocation.id);
    expect(cycle.runs.map((row) => row.id)).toContain(submitted.pending.runId);
    // Who challenged it is answerable.
    const challenge = cycle.messages.find((message) => message.kind === "CHALLENGE");
    expect(challenge).toBeDefined();
    expect(challenge!.fromAgentId).toBe(analyst.id);
    // And the whole thing is present in the event trail.
    const eventTypes = cycle.events.map((event) => event.type);
    expect(eventTypes).toContain("capital.requested");
    expect(eventTypes).toContain("capital.allocated");
    expect(eventTypes).toContain("volara.lesson_recorded");
  });
});

describe("P4-F — enforcement holds through the new runtime", () => {
  it("agent → tool: a capital step never runs without a human's grant", async () => {
    const { user, roster, objective } = await chainSetup();
    const operator = roster.find((agent) => agent.role === "OPERATOR")!;
    const correlationId = randomUUID();
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: operator.id,
      objectiveId: objective.id,
      title: "Ungranted",
      maxLossCents: 1_00,
      correlationId,
    });
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: operator.id,
      name: "Ungranted",
      hypothesis: "H",
      maxLossCents: 1_00,
      correlationId,
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 20_00, correlationId });

    const requested = await requestCapital({
      userId: user.id,
      agentId: operator.id,
      strategyId: strategy.id,
      opportunityId: opportunity.id,
      requestedCents: 5_00,
      rationale: "No human will approve this.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");

    const submitted = await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id });
    if (!submitted.submitted) throw new Error("submit failed");

    // Resume WITHOUT approving, repeatedly. A HOLD does not execute by attrition.
    const { executeRun } = await import("@/lib/agents/executor");
    for (let i = 0; i < 3; i++) await executeRun(user.id, submitted.pending.runId);

    const row = await db.capitalAllocation.findUniqueOrThrow({ where: { id: requested.allocation.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.approvedCents).toBe(0);
    expect((await getTreasuryPosition(user.id)).reservedCents).toBe(0);
  });

  it("a rejected step creates no grant and reserves nothing", async () => {
    const { user, roster } = await chainSetup();
    const operator = roster.find((agent) => agent.role === "OPERATOR")!;
    const correlationId = randomUUID();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: operator.id,
      name: "Rejected",
      hypothesis: "H",
      maxLossCents: 1_00,
      correlationId,
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 20_00, correlationId });

    const requested = await requestCapital({
      userId: user.id,
      agentId: operator.id,
      strategyId: strategy.id,
      requestedCents: 5_00,
      rationale: "Will be declined.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");
    const submitted = await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id });
    if (!submitted.submitted) throw new Error("submit failed");

    const rejected = await rejectAgentStep(user.id, submitted.pending.runId, submitted.pending.stepId);
    expect(rejected.rejected).toBe(true);

    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
    const row = await db.capitalAllocation.findUniqueOrThrow({ where: { id: requested.allocation.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.approvalGrantId).toBeNull();
    expect((await getTreasuryPosition(user.id)).reservedCents).toBe(0);
  });

  it("an expired request cannot be approved even with a live grant path", async () => {
    const { user, roster } = await chainSetup();
    const operator = roster.find((agent) => agent.role === "OPERATOR")!;
    const correlationId = randomUUID();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: operator.id,
      name: "Stale",
      hypothesis: "H",
      maxLossCents: 1_00,
      correlationId,
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 20_00, correlationId });

    const requested = await requestCapital({
      userId: user.id,
      agentId: operator.id,
      strategyId: strategy.id,
      requestedCents: 5_00,
      rationale: "Goes stale.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");

    // Age it past its TTL, then try to submit it.
    await db.capitalAllocation.update({
      where: { id: requested.allocation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id })).toEqual({
      submitted: false,
      reason: "EXPIRED",
    });
    expect((await getTreasuryPosition(user.id)).reservedCents).toBe(0);
  });

  it("a decided allocation cannot be re-decided", async () => {
    const { user, roster } = await chainSetup();
    const operator = roster.find((agent) => agent.role === "OPERATOR")!;
    const correlationId = randomUUID();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: operator.id,
      name: "Once only",
      hypothesis: "H",
      maxLossCents: 1_00,
      correlationId,
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 20_00, correlationId });

    const requested = await requestCapital({
      userId: user.id,
      agentId: operator.id,
      strategyId: strategy.id,
      requestedCents: 5_00,
      rationale: "Decided once.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");

    expect(await rejectCapitalAllocation(user.id, requested.allocation.id, "No.")).toEqual({ rejected: true });
    // A second decision, of either kind, does nothing.
    expect(await rejectCapitalAllocation(user.id, requested.allocation.id, "No again.")).toEqual({ rejected: false });
    expect(await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id })).toEqual({
      submitted: false,
      reason: "NOT_REQUESTED",
    });
  });

  it("one user's allocation is invisible and unreachable from another account", async () => {
    const owner = await chainSetup();
    const attacker = await chainSetup();
    const operator = owner.roster.find((agent) => agent.role === "OPERATOR")!;
    const correlationId = randomUUID();
    const strategy = await proposeStrategy({
      userId: owner.user.id,
      agentId: operator.id,
      name: "Private",
      hypothesis: "H",
      maxLossCents: 1_00,
      correlationId,
    });
    await activateStrategy({
      userId: owner.user.id,
      strategyId: strategy.id,
      maxCapitalCents: 20_00,
      correlationId,
    });
    const requested = await requestCapital({
      userId: owner.user.id,
      agentId: operator.id,
      strategyId: strategy.id,
      requestedCents: 5_00,
      rationale: "Owner's.",
      correlationId,
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");

    // Every cross-account read and write is scoped at the query, so the row is
    // simply NOT FOUND rather than found-and-refused.
    expect(await submitAllocationForApproval({ userId: attacker.user.id, allocationId: requested.allocation.id })).toEqual(
      { submitted: false, reason: "NOT_FOUND" }
    );
    expect(await rejectCapitalAllocation(attacker.user.id, requested.allocation.id, "Not mine.")).toEqual({
      rejected: false,
    });
    expect(await traceAllocation(attacker.user.id, requested.allocation.id)).toBeNull();
    expect((await getTreasuryPosition(attacker.user.id)).reservedCents).toBe(0);
  });
});
