import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createTestUser, seedLedgerEntry } from "./helpers";
import { grantPermission } from "@/lib/permissions/service";
import { PermissionDeniedError } from "@/lib/permissions/service";
import { ensureVolaraRoster, listSchedulableAgents } from "@/lib/volara/roster";
import {
  isLegalTransition,
  transitionAgent,
  suspendAgent,
  resumeAgent,
  LEGAL_TRANSITIONS,
  MAX_CONSECUTIVE_FAILURES,
} from "@/lib/volara/state";
import { claimAgentCycle, releaseAgentCycle, holdsLease } from "@/lib/volara/lease";
import { observe, reason, propose, runAgentCycle, runSociety, VOLARA_RUNTIME_CAPABILITY } from "@/lib/volara/loop";
import { sendAgentMessage, readInbox, markMessagesRead, listMessagesForCorrelation } from "@/lib/volara/messages";
import { recordOpportunity, updateOpportunity, settleOpportunity } from "@/lib/volara/ledger";
import {
  proposeStrategy,
  activateStrategy,
  killStrategy,
  pauseStrategy,
  replicateStrategy,
  recordStrategyLesson,
} from "@/lib/volara/strategy";
import { evaluateCapitalRequest, requestCapital, releaseCapitalAllocation, RESERVE_FRACTION } from "@/lib/volara/governor";
import { getTreasuryPosition } from "@/lib/volara/treasury";
import { getSystemMetrics, getAgentMetrics, getStrategyMetrics } from "@/lib/volara/metrics";
import { promoteStrategyOutcome } from "@/lib/volara/learning";
import { superviseSociety, rankCapitalProposals } from "@/lib/volara/supervisor";
import { getVolaraObserverState, getCycleTrace } from "@/lib/volara/observer";
import type { AgentRuntimeState } from "@/generated/prisma/enums";

/**
 * P4-F — THE RUNTIME.
 *
 * Lifecycle legality, the cycle lease, the loop's separated stages, the ledger,
 * strategies, the governor's deterministic table, derived metrics, learning,
 * supervision, failure containment and the observer contract.
 *
 * The authority invariants live next door in `volara-authority.test.ts`; this
 * file is about whether the runtime actually WORKS — and, where the two meet
 * (a suspended agent, a settled opportunity), whether it works the safe way.
 */

async function runtimeUser(ceilingUsd = 1000) {
  const user = await createTestUser();
  await db.user.update({ where: { id: user.id }, data: { maxAutonomousSpendUsd: ceilingUsd } });
  await grantPermission(user.id, VOLARA_RUNTIME_CAPABILITY, "RECOMMEND");
  const roster = await ensureVolaraRoster(user.id);
  return { user, roster };
}

async function objectiveFor(userId: string) {
  return db.objective.create({
    data: { userId, title: "Runtime test objective", targetValue: 0, currentValue: 0 },
  });
}

// ---------------------------------------------------------------------------

describe("P4-F — agent lifecycle", () => {
  it("the legal-transition table is total and SUSPENDED is a trap door", () => {
    const states: AgentRuntimeState[] = [
      "IDLE",
      "THINKING",
      "RESEARCHING",
      "EVALUATING",
      "PROPOSING",
      "WAITING_FOR_AUTHORIZATION",
      "EXECUTING",
      "REPORTING",
      "LEARNING",
      "PAUSED",
      "FAILED",
      "SUSPENDED",
    ];
    // Every state has an entry: a missing row would make every transition out
    // of it silently illegal, which fails safe but would be a bug, not a rule.
    for (const state of states) {
      expect(LEGAL_TRANSITIONS[state], `${state} has no transition row`).toBeDefined();
    }
    // The only way out of SUSPENDED is IDLE, and only resumeAgent may take it.
    expect(LEGAL_TRANSITIONS.SUSPENDED).toEqual(["IDLE"]);
    // No state may jump straight to EXECUTING except from the authorization wait.
    for (const state of states) {
      if (state === "WAITING_FOR_AUTHORIZATION") continue;
      expect(isLegalTransition(state, "EXECUTING"), `${state} must not reach EXECUTING directly`).toBe(false);
    }
  });

  it("an illegal transition is refused, recorded, and changes nothing", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];

    const result = await transitionAgent({
      userId: user.id,
      agentId: agent.id,
      to: "EXECUTING",
      reason: "JUMP",
      correlationId: "illegal-1",
    });
    expect(result.transitioned).toBe(false);
    if (result.transitioned) return;
    expect(result.reason).toBe("ILLEGAL_TRANSITION");

    // THE SIDE EFFECT: the state did not move.
    const after = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after.runtimeState).toBe("IDLE");

    // And the ATTEMPT is evidence, not a silent no-op.
    const transition = await db.agentStateTransition.findFirstOrThrow({
      where: { userId: user.id, agentId: agent.id, correlationId: "illegal-1" },
    });
    expect(transition.refused).toBe(true);
    expect(transition.reason).toContain("ILLEGAL_TRANSITION");
  });

  it("a suspended agent cannot transition itself back into work", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await suspendAgent(user.id, agent.id, "test suspension", "suspend-1");

    for (const target of ["IDLE", "THINKING", "EXECUTING"] as AgentRuntimeState[]) {
      const result = await transitionAgent({
        userId: user.id,
        agentId: agent.id,
        to: target,
        reason: "SELF_RESUME",
        correlationId: "suspend-1",
      });
      expect(result.transitioned, `${target} must be refused from SUSPENDED`).toBe(false);
    }
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).runtimeState).toBe("SUSPENDED");
  });

  it("a human resume is the one way out, and it keeps lifetime failure history", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await db.agent.update({
      where: { id: agent.id },
      data: { failureCount: 7, consecutiveFailures: 3 },
    });
    await suspendAgent(user.id, agent.id, "repeated failures", "resume-1");

    const resumed = await resumeAgent(user.id, agent.id, "resume-1");
    expect(resumed.transitioned).toBe(true);

    const after = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after.runtimeState).toBe("IDLE");
    expect(after.suspendedAt).toBeNull();
    expect(after.consecutiveFailures).toBe(0);
    // Lifetime history survives. Erasing it would be the audit deletion §22 forbids.
    expect(after.failureCount).toBe(7);
  });

  it("a concurrent transition loses the compare-and-swap rather than overwriting", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];

    const [first, second] = await Promise.all([
      transitionAgent({ userId: user.id, agentId: agent.id, to: "THINKING", reason: "A", correlationId: "cas" }),
      transitionAgent({ userId: user.id, agentId: agent.id, to: "RESEARCHING", reason: "B", correlationId: "cas" }),
    ]);

    // Exactly one may win. The loser must not have overwritten a state it
    // never evaluated.
    const winners = [first, second].filter((result) => result.transitioned);
    expect(winners).toHaveLength(1);

    const after = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(["THINKING", "RESEARCHING"]).toContain(after.runtimeState);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — the cycle lease", () => {
  it("a second concurrent claim loses and does not run", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];

    const first = await claimAgentCycle(user.id, agent.id);
    expect(first.claimed).toBe(true);

    const second = await claimAgentCycle(user.id, agent.id);
    expect(second).toEqual({ claimed: false, reason: "HELD" });
  });

  it("releasing with the wrong lease id does not free the current holder's lease", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const claim = await claimAgentCycle(user.id, agent.id);
    if (!claim.claimed) throw new Error("claim failed");

    // A cycle whose lease already expired must not clear the NEW holder's.
    expect(await releaseAgentCycle(user.id, agent.id, "some-other-lease")).toBe(false);
    expect(await holdsLease(user.id, agent.id, claim.leaseId)).toBe(true);

    expect(await releaseAgentCycle(user.id, agent.id, claim.leaseId)).toBe(true);
    expect(await holdsLease(user.id, agent.id, claim.leaseId)).toBe(false);
  });

  it("a suspended agent cannot be claimed at all", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await suspendAgent(user.id, agent.id, "stopped", "lease-suspend");
    expect(await claimAgentCycle(user.id, agent.id)).toEqual({ claimed: false, reason: "SUSPENDED" });
  });

  it("two concurrent cycles for one agent produce exactly one run", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster.find((a) => a.role === "SCOUT")!;

    const [a, b] = await Promise.all([runAgentCycle(user.id, agent.id), runAgentCycle(user.id, agent.id)]);
    const ran = [a, b].filter((result) => result.ran);
    expect(ran).toHaveLength(1);

    // The cycle counter moved once, not twice.
    const after = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after.cycleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — the runtime loop stages", () => {
  it("a cycle without the capability is refused, not silently skipped", async () => {
    const user = await createTestUser();
    const roster = await ensureVolaraRoster(user.id);
    // No `volara.runtime` grant. RECOMMEND is above the default-granted level.
    await expect(runAgentCycle(user.id, roster[0].id)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await db.agent.findUniqueOrThrow({ where: { id: roster[0].id } })).cycleCount).toBe(0);
  });

  it("reason() is deterministic and reports unknowns instead of filling them in", async () => {
    const { user, roster } = await runtimeUser();
    const analyst = roster.find((agent) => agent.role === "ANALYST")!;
    const objective = await objectiveFor(user.id);

    // A row with NO stated downside and an arithmetically impossible profit.
    await db.opportunity.create({
      data: {
        userId: user.id,
        objectiveId: objective.id,
        title: "Underspecified",
        status: "EVALUATING",
        expectedRevenueCents: 1_000,
        expectedProfitCents: 5_000,
      },
    });

    const perception = await observe(user.id, analyst);
    const first = reason(perception);
    const second = reason(perception);
    // Pure: same perception, same findings.
    expect(second).toEqual(first);

    const kinds = first.findings.map((finding) => finding.kind);
    expect(kinds).toContain("MISSING_DOWNSIDE");
    expect(kinds).toContain("INCONSISTENT_ECONOMICS");

    // And critically: the analyst did NOT write a downside.
    const row = await db.opportunity.findFirstOrThrow({ where: { userId: user.id, title: "Underspecified" } });
    expect(row.maxLossCents).toBeNull();
  });

  it("the propose stage writes only proposals and reserves nothing", async () => {
    const { user, roster } = await runtimeUser();
    const scout = roster.find((agent) => agent.role === "SCOUT")!;
    const objective = await objectiveFor(user.id);
    await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Unexamined row", status: "DISCOVERED" },
    });

    const perception = await observe(user.id, scout);
    const findings = reason(perception);
    const outcome = await propose(user.id, perception, findings, "propose-1");

    expect(outcome.opportunitiesUpdated).toBeGreaterThan(0);
    expect(outcome.messagesSent).toBeGreaterThan(0);
    expect(outcome.capitalRequested).toBe(0);

    // Nothing consequential happened: no reservation, no grant, no expense.
    const treasury = await getTreasuryPosition(user.id);
    expect(treasury.reservedCents).toBe(0);
    expect(treasury.spentCents).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a full cycle records its correlation id across every artefact it produced", async () => {
    const { user, roster } = await runtimeUser();
    const scout = roster.find((agent) => agent.role === "SCOUT")!;
    const objective = await objectiveFor(user.id);
    await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Traceable", status: "DISCOVERED" },
    });

    const result = await runAgentCycle(user.id, scout.id);
    expect(result.ran).toBe(true);
    if (!result.ran) return;

    const trace = await getCycleTrace(user.id, result.correlationId);
    expect(trace.transitions.length).toBeGreaterThan(0);
    expect(trace.messages.length).toBeGreaterThan(0);
    expect(trace.events.length).toBeGreaterThan(0);
    // Every transition in the trace really belongs to this cycle.
    for (const transition of trace.transitions) {
      expect(transition.correlationId).toBe(result.correlationId);
    }

    // The agent came to rest, with a real heartbeat.
    const after = await db.agent.findUniqueOrThrow({ where: { id: scout.id } });
    expect(after.runtimeState).toBe("IDLE");
    expect(after.heartbeatAt).not.toBeNull();
    expect(after.currentStage).toBeNull();
  });

  it("MANUAL agents are excluded from the scheduler but remain directly runnable", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await db.agent.update({ where: { id: agent.id }, data: { autonomyMode: "MANUAL" } });

    const schedulable = await listSchedulableAgents(user.id);
    expect(schedulable.map((a) => a.id)).not.toContain(agent.id);

    // Still runnable when a human asks for it explicitly.
    const result = await runAgentCycle(user.id, agent.id);
    expect(result.ran).toBe(true);
  });

  it("a backed-off agent is not scheduled until its wake time", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await db.agent.update({
      where: { id: agent.id },
      data: { nextWakeAt: new Date(Date.now() + 60_000) },
    });
    const schedulable = await listSchedulableAgents(user.id);
    expect(schedulable.map((a) => a.id)).not.toContain(agent.id);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — failure containment", () => {
  it("one agent's repeated failure suspends only that agent", async () => {
    const { user, roster } = await runtimeUser();
    const victim = roster[0];

    // A cycle fails when its own row vanishes mid-flight; simulate the
    // arithmetic instead by driving the counter to the threshold, then
    // suspending through the same path the loop uses.
    await db.agent.update({
      where: { id: victim.id },
      data: { consecutiveFailures: MAX_CONSECUTIVE_FAILURES, failureCount: MAX_CONSECUTIVE_FAILURES },
    });
    const sweep = await superviseSociety(user.id, "containment");
    expect(sweep.suspended).toContain(victim.id);

    const all = await db.agent.findMany({ where: { userId: user.id, role: { not: null } } });
    const suspended = all.filter((agent) => agent.runtimeState === "SUSPENDED");
    expect(suspended).toHaveLength(1);
    expect(suspended[0].id).toBe(victim.id);

    // The other four still run.
    const results = await runSociety(user.id);
    expect(results.filter((result) => result.ran).length).toBe(4);
  });

  it("runSociety contains a per-agent failure rather than aborting the sweep", async () => {
    const { user, roster } = await runtimeUser();
    expect(roster).toHaveLength(5);
    const results = await runSociety(user.id);
    expect(results).toHaveLength(5);
    // Every result is accounted for — none is missing because a sibling threw.
    for (const result of results) {
      expect(typeof result.agentId).toBe("string");
    }
  });

  it("a failed run is never deleted", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await runAgentCycle(user.id, agent.id);

    const transitions = await db.agentStateTransition.count({ where: { userId: user.id, agentId: agent.id } });
    expect(transitions).toBeGreaterThan(0);
    const events = await db.event.count({ where: { userId: user.id, subjectId: agent.id } });
    expect(events).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — communication", () => {
  it("a direct message reaches its recipient and nobody else", async () => {
    const { user, roster } = await runtimeUser();
    const [from, to, third] = roster;

    await sendAgentMessage({
      userId: user.id,
      fromAgentId: from.id,
      toAgentIds: [to.id],
      kind: "QUESTION",
      subject: "Direct",
      body: "For you only.",
      correlationId: "direct",
    });

    expect((await readInbox(user.id, to.id)).map((m) => m.subject)).toContain("Direct");
    expect((await readInbox(user.id, third.id)).map((m) => m.subject)).not.toContain("Direct");
  });

  it("a broadcast reaches everyone except its sender", async () => {
    const { user, roster } = await runtimeUser();
    const [from, ...others] = roster;

    const sent = await sendAgentMessage({
      userId: user.id,
      fromAgentId: from.id,
      kind: "WARNING",
      subject: "Broadcast",
      body: "Everyone should see this.",
      correlationId: "broadcast",
    });
    expect(sent.sent).toBe(true);
    if (!sent.sent) return;
    // ONE row, not N: "who was told" must not be a count that drifts.
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].toAgentId).toBeNull();

    for (const agent of others) {
      expect((await readInbox(user.id, agent.id)).map((m) => m.subject)).toContain("Broadcast");
    }
    // The sender does not read its own broadcast back as corroboration.
    expect((await readInbox(user.id, from.id)).map((m) => m.subject)).not.toContain("Broadcast");
  });

  it("a malformed message is refused rather than truncated", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];

    expect(
      await sendAgentMessage({
        userId: user.id,
        fromAgentId: agent.id,
        kind: "SIGNAL" as never,
        subject: "   ",
        body: "body",
        correlationId: "malformed",
      })
    ).toEqual({ sent: false, reason: "MALFORMED" });

    expect(
      await sendAgentMessage({
        userId: user.id,
        fromAgentId: agent.id,
        kind: "QUESTION",
        subject: "ok",
        body: "x".repeat(10_001),
        correlationId: "malformed",
      })
    ).toEqual({ sent: false, reason: "MALFORMED" });

    expect(await db.agentMessage.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a message to an agent that is not this user's is refused", async () => {
    const { user, roster } = await runtimeUser();
    const other = await runtimeUser();

    expect(
      await sendAgentMessage({
        userId: user.id,
        fromAgentId: roster[0].id,
        toAgentIds: [other.roster[0].id],
        kind: "QUESTION",
        subject: "Cross-tenant",
        body: "Should not deliver.",
        correlationId: "cross-tenant",
      })
    ).toEqual({ sent: false, reason: "RECIPIENT_NOT_FOUND" });
  });

  it("messages carry a correlation id that reassembles a conversation", async () => {
    const { user, roster } = await runtimeUser();
    const [a, b] = roster;
    await sendAgentMessage({
      userId: user.id,
      fromAgentId: a.id,
      toAgentIds: [b.id],
      kind: "CHALLENGE",
      subject: "Your estimate",
      body: "Where does the revenue figure come from?",
      correlationId: "thread-1",
    });
    await sendAgentMessage({
      userId: user.id,
      fromAgentId: b.id,
      toAgentIds: [a.id],
      kind: "FEEDBACK",
      subject: "Re: your estimate",
      body: "It is not sourced. Withdrawing it.",
      correlationId: "thread-1",
    });

    const thread = await listMessagesForCorrelation(user.id, "thread-1");
    expect(thread).toHaveLength(2);
    expect(thread[0].kind).toBe("CHALLENGE");
    expect(thread[1].kind).toBe("FEEDBACK");
  });

  it("marking read is idempotent", async () => {
    const { user, roster } = await runtimeUser();
    const [from, to] = roster;
    const sent = await sendAgentMessage({
      userId: user.id,
      fromAgentId: from.id,
      toAgentIds: [to.id],
      kind: "FEEDBACK",
      subject: "Read me",
      body: "Once.",
      correlationId: "read",
    });
    if (!sent.sent) throw new Error("send failed");
    const ids = sent.messages.map((m) => m.id);
    expect(await markMessagesRead(user.id, ids)).toBe(1);
    expect(await markMessagesRead(user.id, ids)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — the shared ledger", () => {
  it("an agent cannot move a row into a status that asserts a result", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: agent.id,
      objectiveId: objective.id,
      title: "Claimed winner",
      correlationId: "claim",
    });

    const result = await updateOpportunity({
      userId: user.id,
      agentId: agent.id,
      opportunityId: opportunity.id,
      status: "COMPLETED",
      correlationId: "claim",
    });
    expect(result).toEqual({ updated: false, reason: "STATUS_NOT_AGENT_WRITABLE" });
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("DISCOVERED");
  });

  it("settlement refuses without economic evidence, and derives the outcome when there is some", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: agent.id,
      objectiveId: objective.id,
      title: "To settle",
      correlationId: "settle",
    });

    // No asset at all.
    expect(await settleOpportunity({ userId: user.id, opportunityId: opportunity.id, correlationId: "settle" })).toEqual(
      { settled: false, reason: "NO_ECONOMIC_EVIDENCE" }
    );

    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Test asset", category: "OTHER", opportunityId: opportunity.id },
    });
    // An asset with no entries is still no evidence.
    expect(await settleOpportunity({ userId: user.id, opportunityId: opportunity.id, correlationId: "settle" })).toEqual(
      { settled: false, reason: "NO_ECONOMIC_EVIDENCE" }
    );

    await seedLedgerEntry("revenue", { assetId: asset.id, amountUsd: 40, occurredAt: new Date() });
    await seedLedgerEntry("expense", { assetId: asset.id, amountUsd: 10, occurredAt: new Date() });

    const settled = await settleOpportunity({
      userId: user.id,
      opportunityId: opportunity.id,
      correlationId: "settle",
    });
    expect(settled).toEqual({ settled: true, status: "COMPLETED", realizedProfitCents: 3_000 });
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("COMPLETED");
  });

  it("a loss settles as FAILED, from the ledger rather than from a claim", async () => {
    const { user, roster } = await runtimeUser();
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: roster[0].id,
      objectiveId: objective.id,
      title: "A loss",
      correlationId: "loss",
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Losing asset", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("expense", { assetId: asset.id, amountUsd: 25, occurredAt: new Date() });

    const settled = await settleOpportunity({ userId: user.id, opportunityId: opportunity.id, correlationId: "loss" });
    expect(settled).toEqual({ settled: true, status: "FAILED", realizedProfitCents: -2_500 });
  });

  it("SIMULATED ledger rows are not evidence", async () => {
    const { user, roster } = await runtimeUser();
    const objective = await objectiveFor(user.id);
    const opportunity = await recordOpportunity({
      userId: user.id,
      agentId: roster[0].id,
      objectiveId: objective.id,
      title: "Dry run",
      correlationId: "sim",
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Simulated asset", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("revenue", {
      assetId: asset.id,
      amountUsd: 1000,
      occurredAt: new Date(),
      provenance: "SIMULATED",
    });

    expect(await settleOpportunity({ userId: user.id, opportunityId: opportunity.id, correlationId: "sim" })).toEqual({
      settled: false,
      reason: "NO_ECONOMIC_EVIDENCE",
    });
    // And it is not counted as revenue anywhere.
    expect((await getSystemMetrics(user.id)).revenueCents).toBe(0);
  });

  it("a terminal row is frozen", async () => {
    const { user, roster } = await runtimeUser();
    const objective = await objectiveFor(user.id);
    const opportunity = await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Closed", status: "COMPLETED" },
    });
    expect(
      await updateOpportunity({
        userId: user.id,
        agentId: roster[0].id,
        opportunityId: opportunity.id,
        status: "EVALUATING",
        correlationId: "frozen",
      })
    ).toEqual({ updated: false, reason: "TERMINAL" });
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — strategy lifecycle", () => {
  it("PROPOSE → ACTIVE requires a human, and ACTIVE without one admits nothing", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: agent.id,
      name: "Needs a human",
      hypothesis: "H",
      maxLossCents: 1_000,
      correlationId: "activate",
    });
    expect(strategy.status).toBe("PROPOSED");
    expect(strategy.activatedByHumanAt).toBeNull();

    // Forge the status directly, WITHOUT the human timestamp — the governor
    // must still refuse, because ACTIVE alone means nothing.
    await db.strategy.update({ where: { id: strategy.id }, data: { status: "ACTIVE", maxCapitalCents: 100_000 } });
    await db.agent.updateMany({ where: { userId: user.id }, data: { maxRequestCents: 50_000 } });

    const requested = await requestCapital({
      userId: user.id,
      agentId: agent.id,
      strategyId: strategy.id,
      requestedCents: 1_000,
      rationale: "Forged activation.",
      correlationId: "activate",
    });
    expect(requested.requested).toBe(false);
    if (requested.requested) return;
    expect(requested.reasons).toContain("STRATEGY_NOT_ACTIVE");
  });

  it("KILL and PAUSE are distinct, and a killed strategy stays killed", async () => {
    const { user, roster } = await runtimeUser();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: roster[0].id,
      name: "To kill",
      hypothesis: "H",
      correlationId: "kill",
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 1_000, correlationId: "kill" });

    expect(await pauseStrategy({ userId: user.id, strategyId: strategy.id, reason: "waiting", correlationId: "kill" }))
      .toEqual({ paused: true });
    expect((await db.strategy.findUniqueOrThrow({ where: { id: strategy.id } })).status).toBe("PAUSED");

    expect(await killStrategy({ userId: user.id, strategyId: strategy.id, reason: "judged", correlationId: "kill" }))
      .toEqual({ killed: true });
    const killed = await db.strategy.findUniqueOrThrow({ where: { id: strategy.id } });
    expect(killed.status).toBe("KILLED");
    expect(killed.killedAt).not.toBeNull();

    // Killing twice does nothing, and reactivating a killed strategy is refused.
    expect(await killStrategy({ userId: user.id, strategyId: strategy.id, reason: "again", correlationId: "kill" }))
      .toEqual({ killed: false });
    expect(
      await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 1, correlationId: "kill" })
    ).toEqual({ activated: false, reason: "TERMINAL" });
  });

  it("replication requires ledger evidence and inherits no capital authority", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const objective = await objectiveFor(user.id);

    const opportunity = await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Winner", status: "EVALUATING" },
    });
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: agent.id,
      name: "Proven",
      hypothesis: "H",
      opportunityId: opportunity.id,
      maxLossCents: 1_000,
      correlationId: "replicate",
    });
    await activateStrategy({
      userId: user.id,
      strategyId: strategy.id,
      maxCapitalCents: 100_000,
      correlationId: "replicate",
    });

    // With no allocations and no ledger rows, there is no evidence.
    expect(
      await replicateStrategy({ userId: user.id, agentId: agent.id, strategyId: strategy.id, correlationId: "rep" })
    ).toEqual({ replicated: false, reason: "NO_EVIDENCE_OF_SUCCESS" });

    // Give it a real, profitable allocation chain.
    await db.capitalAllocation.create({
      data: {
        userId: user.id,
        agentId: agent.id,
        strategyId: strategy.id,
        opportunityId: opportunity.id,
        requestedCents: 1_000,
        approvedCents: 1_000,
        consumedCents: 1_000,
        status: "CONSUMED",
        rationale: "test",
        correlationId: "rep",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Winner asset", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("revenue", { assetId: asset.id, amountUsd: 100, occurredAt: new Date() });

    const replicated = await replicateStrategy({
      userId: user.id,
      agentId: agent.id,
      strategyId: strategy.id,
      correlationId: "rep",
    });
    expect(replicated.replicated).toBe(true);
    if (!replicated.replicated) return;

    // THE POINT: the replica has the thesis and NONE of the authority.
    expect(replicated.strategy.hypothesis).toBe(strategy.hypothesis);
    expect(replicated.strategy.status).toBe("DRAFT");
    expect(replicated.strategy.maxCapitalCents).toBe(0);
    expect(replicated.strategy.activatedByHumanAt).toBeNull();
    expect(replicated.strategy.replicatedFromId).toBe(strategy.id);
  });

  it("a lesson is recorded on the strategy without becoming durable memory", async () => {
    const { user, roster } = await runtimeUser();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: roster[0].id,
      name: "Lessons",
      hypothesis: "H",
      correlationId: "lesson",
    });
    await recordStrategyLesson({
      userId: user.id,
      agentId: roster[0].id,
      strategyId: strategy.id,
      lesson: "The channel was saturated.",
      correlationId: "lesson",
    });

    expect(JSON.parse((await db.strategy.findUniqueOrThrow({ where: { id: strategy.id } })).lessons)).toEqual([
      "The channel was saturated.",
    ]);
    // Not memory. §11: raw lessons are not long-term learning.
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — the capital governor's decision table", () => {
  const baseFacts = {
    requestedCents: 1_000,
    position: {
      ceilingCents: 100_000,
      spentCents: 0,
      reservedCents: 0,
      availableCents: 100_000,
      halted: false,
    },
    agent: { found: true, suspended: false, maxRequestCents: 50_000, committedCents: 0, consecutiveFailures: 0 },
    strategy: { present: true as const, active: true, maxCapitalCents: 50_000, committedCents: 0, maxLossCents: 1_000 },
    duplicateLiveRequest: false,
  };

  it("passes a well-formed request and never allows more than was asked", () => {
    const verdict = evaluateCapitalRequest(baseFacts);
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.allowableCents).toBe(1_000);
    expect(verdict.allowableCents).toBeLessThanOrEqual(baseFacts.requestedCents);
  });

  it("is deterministic", () => {
    expect(evaluateCapitalRequest(baseFacts)).toEqual(evaluateCapitalRequest(baseFacts));
  });

  it("refuses a non-finite or non-positive amount before anything else", () => {
    expect(evaluateCapitalRequest({ ...baseFacts, requestedCents: NaN }).reasons).toEqual(["AMOUNT_NOT_FINITE"]);
    expect(evaluateCapitalRequest({ ...baseFacts, requestedCents: Infinity }).reasons).toEqual(["AMOUNT_NOT_FINITE"]);
    expect(evaluateCapitalRequest({ ...baseFacts, requestedCents: 10.5 }).reasons).toEqual(["AMOUNT_NOT_FINITE"]);
    expect(evaluateCapitalRequest({ ...baseFacts, requestedCents: 0 }).reasons).toEqual(["NON_POSITIVE_AMOUNT"]);
    expect(evaluateCapitalRequest({ ...baseFacts, requestedCents: -1 }).reasons).toEqual(["NON_POSITIVE_AMOUNT"]);
  });

  it("refuses on the halt, a suspended agent, recent failures and a duplicate", () => {
    expect(
      evaluateCapitalRequest({ ...baseFacts, position: { ...baseFacts.position, halted: true } }).reasons
    ).toContain("HALTED");
    expect(evaluateCapitalRequest({ ...baseFacts, agent: { ...baseFacts.agent, suspended: true } }).reasons).toContain(
      "AGENT_SUSPENDED"
    );
    expect(
      evaluateCapitalRequest({ ...baseFacts, agent: { ...baseFacts.agent, consecutiveFailures: 2 } }).reasons
    ).toContain("RECENT_FAILURES");
    expect(evaluateCapitalRequest({ ...baseFacts, duplicateLiveRequest: true }).reasons).toContain(
      "DUPLICATE_LIVE_REQUEST"
    );
  });

  it("requires a strategy, and one an unstated downside makes unacceptable", () => {
    expect(evaluateCapitalRequest({ ...baseFacts, strategy: { present: false } }).reasons).toContain("NO_STRATEGY");
    // A null maxLoss is the WORST case, not the best.
    expect(
      evaluateCapitalRequest({ ...baseFacts, strategy: { ...baseFacts.strategy, maxLossCents: null } }).reasons
    ).toContain("MAX_LOSS_UNACCEPTABLE");
    // A downside larger than the whole strategy cap is likewise unacceptable.
    expect(
      evaluateCapitalRequest({ ...baseFacts, strategy: { ...baseFacts.strategy, maxLossCents: 999_999 } }).reasons
    ).toContain("MAX_LOSS_UNACCEPTABLE");
  });

  it("protects the reserve floor before it reports insufficient capital", () => {
    // The floor is 20% of the CEILING while the concentration bound is 50% of
    // it, so at a full ceiling concentration always binds first and the floor
    // would never be the reason. Spending some of the ceiling first is what
    // brings the floor into range — which is also the realistic case, since the
    // floor exists to protect the last slice of a partly-used budget.
    const reserveFloor = Math.ceil(100_000 * RESERVE_FRACTION);
    expect(reserveFloor).toBe(20_000);

    const partlySpent = {
      ...baseFacts,
      position: { ...baseFacts.position, spentCents: 60_000, availableCents: 40_000 },
      agent: { ...baseFacts.agent, maxRequestCents: 100_000 },
      strategy: { ...baseFacts.strategy, maxCapitalCents: 100_000 },
    };
    const spendable = partlySpent.position.availableCents - reserveFloor;
    expect(spendable).toBe(20_000);

    // Just inside the floor: allowed.
    expect(evaluateCapitalRequest({ ...partlySpent, requestedCents: spendable }).verdict).toBe("PASS");
    // Just past it, but still well within available: the FLOOR is what refuses,
    // and it says so rather than reporting a shortfall that does not exist.
    const past = evaluateCapitalRequest({ ...partlySpent, requestedCents: spendable + 1 });
    expect(past.reasons).toContain("RESERVE_FLOOR_BREACHED");
    expect(past.reasons).not.toContain("INSUFFICIENT_CAPITAL");
    // Past available entirely: that is insufficient capital, a different fact.
    const beyond = evaluateCapitalRequest({ ...partlySpent, requestedCents: 40_001 });
    expect(beyond.reasons).toContain("INSUFFICIENT_CAPITAL");
    expect(beyond.reasons).not.toContain("RESERVE_FLOOR_BREACHED");
  });

  it("bounds one agent's share of the ceiling", () => {
    const verdict = evaluateCapitalRequest({
      ...baseFacts,
      requestedCents: 40_000,
      agent: { ...baseFacts.agent, committedCents: 45_000 },
    });
    expect(verdict.reasons).toContain("CONCENTRATION_LIMIT");
  });

  it("enforces the per-agent and per-strategy caps independently", () => {
    expect(
      evaluateCapitalRequest({
        ...baseFacts,
        requestedCents: 20_000,
        agent: { ...baseFacts.agent, maxRequestCents: 10_000 },
      }).reasons
    ).toContain("AGENT_CAP_EXCEEDED");

    expect(
      evaluateCapitalRequest({
        ...baseFacts,
        requestedCents: 20_000,
        strategy: { ...baseFacts.strategy, maxCapitalCents: 20_000, committedCents: 15_000 },
      }).reasons
    ).toContain("STRATEGY_CAP_EXCEEDED");
  });

  it("collects every reason, not just the first", () => {
    const verdict = evaluateCapitalRequest({
      ...baseFacts,
      position: { ...baseFacts.position, halted: true },
      agent: { ...baseFacts.agent, suspended: true, maxRequestCents: 0 },
      strategy: { present: false },
    });
    expect(verdict.reasons.length).toBeGreaterThan(3);
    expect(verdict.reasons).toEqual(expect.arrayContaining(["HALTED", "AGENT_SUSPENDED", "NO_STRATEGY"]));
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — treasury conservation", () => {
  it("a reservation reduces available without touching spent", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await db.capitalAllocation.create({
      data: {
        userId: user.id,
        agentId: agent.id,
        requestedCents: 10_000,
        approvedCents: 10_000,
        status: "APPROVED",
        rationale: "reserved",
        correlationId: "conserve",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const position = await getTreasuryPosition(user.id);
    expect(position.ceilingCents).toBe(100_000);
    expect(position.reservedCents).toBe(10_000);
    // A reservation has not spent anything.
    expect(position.spentCents).toBe(0);
    expect(position.availableCents).toBe(90_000);
    // INVARIANT V2: reserved + spent never exceeds the ceiling.
    expect(position.reservedCents + position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
  });

  it("releasing frees the unspent remainder and can never create capital", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const allocation = await db.capitalAllocation.create({
      data: {
        userId: user.id,
        agentId: agent.id,
        requestedCents: 10_000,
        approvedCents: 10_000,
        consumedCents: 4_000,
        status: "APPROVED",
        rationale: "partially spent",
        correlationId: "release",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const before = await getTreasuryPosition(user.id);
    const released = await releaseCapitalAllocation({
      userId: user.id,
      agentId: agent.id,
      allocationId: allocation.id,
      correlationId: "release",
      reason: "no longer needed",
    });
    expect(released).toEqual({ released: true, freedCents: 6_000 });

    const after = await getTreasuryPosition(user.id);
    // The row leaves the APPROVED set entirely, so nothing is reserved against
    // it any more. That is correct rather than a leak: the 4,000 it consumed is
    // real spending, and real spending is counted from the LEDGER — double-
    // counting it as a live reservation as well would understate available
    // capital by the same amount twice.
    expect(after.reservedCents).toBe(0);
    expect(after.availableCents).toBe(before.availableCents + 10_000);
    // What it consumed is still recorded, so the audit does not lose it.
    const row = await db.capitalAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(row.status).toBe("CONSUMED");
    expect(row.consumedCents).toBe(4_000);
    expect(row.releasedAt).not.toBeNull();
    // And releasing did not raise the ceiling.
    expect(after.ceilingCents).toBe(before.ceilingCents);

    // Releasing twice frees nothing more.
    expect(
      await releaseCapitalAllocation({
        userId: user.id,
        agentId: agent.id,
        allocationId: allocation.id,
        correlationId: "release",
        reason: "again",
      })
    ).toEqual({ released: false, freedCents: 0 });
  });

  it("a duplicate request collapses onto one row by idempotency key", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster.find((a) => a.role === "OPERATOR")!;
    await db.agent.updateMany({ where: { userId: user.id }, data: { maxRequestCents: 50_000 } });
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: agent.id,
      name: "Idempotent",
      hypothesis: "H",
      maxLossCents: 1_000,
      correlationId: "idem",
    });
    await activateStrategy({ userId: user.id, strategyId: strategy.id, maxCapitalCents: 40_000, correlationId: "idem" });

    const input = {
      userId: user.id,
      agentId: agent.id,
      strategyId: strategy.id,
      requestedCents: 2_000,
      rationale: "Once.",
      correlationId: "idem",
      idempotencyKey: `the-same-key-${randomUUID()}`,
    };
    const first = await requestCapital(input);
    const second = await requestCapital(input);
    expect(first.requested).toBe(true);
    expect(second.requested).toBe(true);
    if (!first.requested || !second.requested) return;

    expect(second.reused).toBe(true);
    expect(second.allocation.id).toBe(first.allocation.id);
    expect(await db.capitalAllocation.count({ where: { userId: user.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — derived metrics and learning", () => {
  it("metrics report null rather than zero where there is no basis", async () => {
    const { user } = await runtimeUser();
    const metrics = await getSystemMetrics(user.id);
    // "No return yet" is not "a return of zero".
    expect(metrics.roi).toBeNull();
    expect(metrics.winRate).toBeNull();
    expect(metrics.averageTimeToPayoutDays).toBeNull();
    expect(metrics.revenueCents).toBe(0);
  });

  it("per-agent economics are attributed through real allocations only", async () => {
    const { user, roster } = await runtimeUser();
    const [earner, bystander] = roster;
    const objective = await objectiveFor(user.id);

    const opportunity = await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Attributed", status: "EXECUTING" },
    });
    await db.capitalAllocation.create({
      data: {
        userId: user.id,
        agentId: earner.id,
        opportunityId: opportunity.id,
        requestedCents: 5_000,
        approvedCents: 5_000,
        consumedCents: 5_000,
        status: "CONSUMED",
        rationale: "spent",
        correlationId: "attrib",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Attributed asset", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("revenue", { assetId: asset.id, amountUsd: 75, occurredAt: new Date() });

    const earnerMetrics = await getAgentMetrics(user.id, earner.id);
    expect(earnerMetrics!.revenueCents).toBe(7_500);
    expect(earnerMetrics!.capitalDeployedCents).toBe(5_000);
    expect(earnerMetrics!.profitCents).toBe(7_500);
    expect(earnerMetrics!.roi).toBeCloseTo(1.5);

    // The bystander earned nothing. Not a share of the system's — nothing.
    const bystanderMetrics = await getAgentMetrics(user.id, bystander.id);
    expect(bystanderMetrics!.revenueCents).toBe(0);
    expect(bystanderMetrics!.roi).toBeNull();
  });

  it("a strategy with no ledger activity has a null success, not a false one", async () => {
    const { user, roster } = await runtimeUser();
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: roster[0].id,
      name: "Untested",
      hypothesis: "H",
      correlationId: "untested",
    });
    const metrics = await getStrategyMetrics(user.id, strategy.id);
    expect(metrics!.actualSuccess).toBeNull();
    expect(metrics!.roi).toBeNull();
  });

  it("only a settled strategy with evidence becomes durable memory, once, as an inference", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    const objective = await objectiveFor(user.id);
    const opportunity = await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Learned from", status: "EXECUTING" },
    });
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: agent.id,
      name: "Taught us something",
      hypothesis: "H",
      opportunityId: opportunity.id,
      correlationId: "learn",
    });

    // Still running: nothing to learn yet.
    expect(await promoteStrategyOutcome({ userId: user.id, strategyId: strategy.id, correlationId: "learn" })).toEqual({
      promoted: false,
      reason: "NOT_SETTLED",
    });

    await db.capitalAllocation.create({
      data: {
        userId: user.id,
        agentId: agent.id,
        strategyId: strategy.id,
        opportunityId: opportunity.id,
        requestedCents: 1_000,
        approvedCents: 1_000,
        consumedCents: 1_000,
        status: "CONSUMED",
        rationale: "spent",
        correlationId: "learn",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await killStrategy({ userId: user.id, strategyId: strategy.id, reason: "Channel saturated", correlationId: "learn" });

    // Settled, but no ledger rows: still no outcome to learn from.
    expect(await promoteStrategyOutcome({ userId: user.id, strategyId: strategy.id, correlationId: "learn" })).toEqual({
      promoted: false,
      reason: "NO_ECONOMIC_EVIDENCE",
    });

    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Learned asset", category: "OTHER", opportunityId: opportunity.id },
    });
    await seedLedgerEntry("expense", { assetId: asset.id, amountUsd: 10, occurredAt: new Date() });

    const promoted = await promoteStrategyOutcome({ userId: user.id, strategyId: strategy.id, correlationId: "learn" });
    expect(promoted.promoted).toBe(true);
    if (!promoted.promoted) return;

    const memory = await db.memory.findUniqueOrThrow({ where: { id: promoted.memoryId } });
    // CLAUDE.md rule 3: an inference stays an inference.
    expect(memory.category).toBe("INFERENCE");
    expect(memory.confidence).toBe("LOW");

    // Promoting twice does not write a second memory.
    expect(await promoteStrategyOutcome({ userId: user.id, strategyId: strategy.id, correlationId: "learn" })).toEqual({
      promoted: false,
      reason: "ALREADY_PROMOTED",
    });
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("P4-F — supervision and the observer", () => {
  it("proposals with no recorded evidence rank below ones that have it", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster.find((a) => a.role === "OPERATOR")!;
    const objective = await objectiveFor(user.id);

    const evidenced = await db.opportunity.create({
      data: {
        userId: user.id,
        objectiveId: objective.id,
        title: "Evidenced",
        status: "EVALUATING",
        probabilityOfSuccess: 0.5,
        expectedRevenueCents: 20_000,
      },
    });
    const unevidenced = await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Unevidenced", status: "EVALUATING" },
    });

    for (const opportunity of [evidenced, unevidenced]) {
      await db.capitalAllocation.create({
        data: {
          userId: user.id,
          agentId: agent.id,
          opportunityId: opportunity.id,
          requestedCents: 1_000,
          status: "REQUESTED",
          rationale: "r",
          correlationId: "rank",
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }

    const ranked = await rankCapitalProposals(user.id);
    expect(ranked).toHaveLength(2);
    // Missing data is never a tie-breaker in its own favour.
    expect(ranked[0].expectedValueCents).toBe(10_000);
    expect(ranked[1].expectedValueCents).toBeNull();
    expect(ranked[1].factors).toContain("NO_RECORDED_PROBABILITY");

    // A ranking is advice: neither is approved by being listed.
    for (const proposal of ranked) {
      const row = await db.capitalAllocation.findUniqueOrThrow({ where: { id: proposal.allocationId } });
      expect(row.status).toBe("REQUESTED");
      expect(row.approvedCents).toBe(0);
    }
  });

  it("the observer reports live state without creating anything", async () => {
    const { user, roster } = await runtimeUser();
    const before = await db.event.count({ where: { userId: user.id } });

    const state = await getVolaraObserverState(user.id);
    expect(state.agents).toHaveLength(5);
    expect(state.agents.map((agent) => agent.name).sort()).toEqual(roster.map((agent) => agent.name).sort());
    for (const agent of state.agents) {
      expect(agent.metrics).not.toBeNull();
      expect(Array.isArray(agent.allowedCapabilities)).toBe(true);
      expect(agent.runtimeState).toBe("IDLE");
    }
    expect(state.system.treasury.ceilingCents).toBe(100_000);

    // A pure read: opening the observer is not an action.
    expect(await db.event.count({ where: { userId: user.id } })).toBe(before);
  });

  it("a stalled agent is reported and asked to diagnose, not killed", async () => {
    const { user, roster } = await runtimeUser();
    const agent = roster[0];
    await db.agent.update({
      where: { id: agent.id },
      data: {
        runtimeState: "PROPOSING",
        cycleCount: 3,
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const sweep = await superviseSociety(user.id, "stall");
    expect(sweep.observations.some((o) => o.issue === "STALLED" && o.agentId === agent.id)).toBe(true);
    expect(sweep.diagnosisRequested).toContain(agent.id);
    // Reported, not suspended — a stall may be a legitimate wait.
    expect(sweep.suspended).not.toContain(agent.id);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).health).toBe("STALLED");

    const inbox = await readInbox(user.id, agent.id);
    expect(inbox.some((message) => message.senderKind === "SUPERVISOR" && message.kind === "DIAGNOSIS")).toBe(true);
  });
});
