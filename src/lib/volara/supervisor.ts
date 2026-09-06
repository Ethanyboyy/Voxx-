/**
 * [P4-F] SUPERVISOR COORDINATION over the Volara society.
 *
 * The existing `src/lib/supervisor/service.ts` plans an Objective and drives a
 * SupervisorRun. It is untouched. This module is the coordination the brief
 * describes at the society level — detect stalled agents, detect repeated
 * failures, compare competing capital proposals, suspend the unhealthy, request
 * diagnosis — and it is deliberately thin, because a supervisor that did more
 * would be micromanaging tool calls, which §13 forbids.
 *
 * WHAT THE SUPERVISOR CANNOT DO, and how:
 *
 *   - It cannot grant a capability. This file does not import
 *     `grantPermission`. Coordination is not authorization.
 *   - It cannot approve capital. It does not import `approveCapitalAllocation`;
 *     comparing proposals produces a RANKING, which is advice for a human.
 *   - It cannot execute anything consequential. It writes `Event` rows and
 *     `AgentMessage` rows and changes agent runtime state. Every one of those
 *     is internal.
 *   - Its messages carry no more weight than an agent's. `senderKind:
 *     "SUPERVISOR"` is provenance, not permission, and nothing on the execution
 *     path reads either.
 *
 * A supervisor decision is recorded as a `supervisor.decision` Event rather
 * than in a new `SupervisorDecision` table: the Event model already carries a
 * type, a subject, a payload, a timestamp and a consequential flag, already
 * feeds the live bus and the activity surfaces, and is already the audit trail
 * everything else in VOX writes to. A parallel table would be a second timeline.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { sendAgentMessage } from "@/lib/volara/messages";
import { MAX_CONSECUTIVE_FAILURES, suspendAgent } from "@/lib/volara/state";
import { getTreasuryPosition } from "@/lib/volara/treasury";
import type { CapitalAllocation } from "@/generated/prisma/client";

/** How long without a heartbeat before an agent counts as stalled. */
export const STALL_THRESHOLD_MS = 15 * 60 * 1000;

export interface SupervisorObservation {
  agentId: string;
  name: string;
  issue: "STALLED" | "REPEATED_FAILURES" | "UNHEALTHY";
  detail: Record<string, unknown>;
}

export interface SupervisorSweep {
  observations: SupervisorObservation[];
  suspended: string[];
  diagnosisRequested: string[];
}

/**
 * Looks at the society's health and acts on what it finds.
 *
 * Two actions, and only two. A repeatedly failing agent is SUSPENDED — the
 * runtime already does this from inside the cycle, and doing it here as well
 * catches an agent whose failures came from somewhere the cycle's own handler
 * did not see. A stalled agent gets a diagnosis REQUEST, which is a message,
 * which does nothing on its own — that is correct, because a stall may be a
 * legitimate wait and killing it automatically would be worse than reporting it.
 */
export async function superviseSociety(userId: string, correlationId: string): Promise<SupervisorSweep> {
  const now = new Date();
  const agents = await db.agent.findMany({
    where: { userId, role: { not: null }, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      name: true,
      runtimeState: true,
      health: true,
      heartbeatAt: true,
      consecutiveFailures: true,
      cycleCount: true,
    },
  });

  const observations: SupervisorObservation[] = [];
  const suspended: string[] = [];
  const diagnosisRequested: string[] = [];

  for (const agent of agents) {
    if (agent.runtimeState === "SUSPENDED") continue;

    if (agent.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      observations.push({
        agentId: agent.id,
        name: agent.name,
        issue: "REPEATED_FAILURES",
        detail: { consecutiveFailures: agent.consecutiveFailures },
      });
      const stopped = await suspendAgent(
        userId,
        agent.id,
        `Supervisor: ${agent.consecutiveFailures} consecutive failures`,
        correlationId
      );
      if (stopped) suspended.push(agent.id);
      continue;
    }

    // Stalled: an agent that has run at least once and has not been heard from
    // since. An agent that has never run is not stalled — it has not started.
    const stalledFor = agent.heartbeatAt ? now.getTime() - agent.heartbeatAt.getTime() : null;
    if (
      agent.cycleCount > 0 &&
      agent.runtimeState !== "IDLE" &&
      stalledFor !== null &&
      stalledFor > STALL_THRESHOLD_MS
    ) {
      observations.push({
        agentId: agent.id,
        name: agent.name,
        issue: "STALLED",
        detail: { stalledForMs: stalledFor, state: agent.runtimeState },
      });
      await db.agent.updateMany({ where: { id: agent.id, userId }, data: { health: "STALLED" } });
      await sendAgentMessage({
        userId,
        senderKind: "SUPERVISOR",
        toAgentIds: [agent.id],
        kind: "DIAGNOSIS",
        priority: "HIGH",
        subject: "Stalled — diagnosis requested",
        body: `No heartbeat for ${Math.round(stalledFor / 60000)} minutes while in ${agent.runtimeState}. Report what you are waiting on.`,
        correlationId,
      });
      diagnosisRequested.push(agent.id);
    }
  }

  if (observations.length > 0) {
    await recordEvent({
      userId,
      type: VOLARA_EVENTS.SUPERVISOR_DECISION,
      subjectType: "User",
      subjectId: userId,
      consequential: true,
      payload: { decision: "HEALTH_SWEEP", observations, suspended, diagnosisRequested, correlationId },
    });
  }

  return { observations, suspended, diagnosisRequested };
}

export interface RankedProposal {
  allocationId: string;
  agentId: string;
  strategyId: string | null;
  requestedCents: number;
  /** Recorded evidence only. Null where nothing was recorded — never a guess. */
  probabilityOfSuccess: number | null;
  maxLossCents: number | null;
  /** probability × expected return, in cents. Null when either input is absent. */
  expectedValueCents: number | null;
  /** The strategy's realized profit so far, from the ledger. */
  strategyRealizedProfitCents: number;
  /** Why it sits where it does. Codes, so the ranking is explicable. */
  factors: string[];
}

/**
 * Ranks the live capital requests so a human can compare them.
 *
 * THIS APPROVES NOTHING. It returns an ordered list with the reasons attached;
 * the approval is still the existing ApprovalGrant path, and a request at the
 * top of this list has exactly as much authority as one at the bottom, which is
 * none.
 *
 * The ordering is deterministic and reads only recorded values. A request whose
 * expected value cannot be computed — because no probability or no expected
 * return was recorded — sorts BELOW every request that can be computed, rather
 * than being assigned an optimistic default. Missing data is not a tie-breaker
 * in its own favour.
 */
export async function rankCapitalProposals(userId: string): Promise<RankedProposal[]> {
  const allocations = await db.capitalAllocation.findMany({
    where: { userId, status: "REQUESTED", expiresAt: { gt: new Date() } },
    include: {
      strategy: { select: { id: true, probabilityOfSuccess: true, maxLossCents: true, expectedReturnCents: true } },
      opportunity: { select: { probabilityOfSuccess: true, maxLossCents: true, expectedRevenueCents: true } },
    },
  });
  if (allocations.length === 0) return [];

  const { realizedProfitForOpportunities } = await import("@/lib/volara/strategy");

  const ranked: RankedProposal[] = [];
  for (const allocation of allocations) {
    const probability = allocation.opportunity?.probabilityOfSuccess ?? allocation.strategy?.probabilityOfSuccess ?? null;
    const expectedReturn = allocation.opportunity?.expectedRevenueCents ?? allocation.strategy?.expectedReturnCents ?? null;
    const maxLoss = allocation.opportunity?.maxLossCents ?? allocation.strategy?.maxLossCents ?? null;

    const strategyOpportunityIds = allocation.opportunityId ? [allocation.opportunityId] : [];
    const strategyRealizedProfitCents = await realizedProfitForOpportunities(userId, strategyOpportunityIds);

    const factors: string[] = [];
    if (probability === null) factors.push("NO_RECORDED_PROBABILITY");
    if (expectedReturn === null) factors.push("NO_RECORDED_EXPECTED_RETURN");
    if (maxLoss === null) factors.push("UNBOUNDED_DOWNSIDE");
    if (strategyRealizedProfitCents > 0) factors.push("PRIOR_REALIZED_PROFIT");
    if (strategyRealizedProfitCents < 0) factors.push("PRIOR_REALIZED_LOSS");

    ranked.push({
      allocationId: allocation.id,
      agentId: allocation.agentId,
      strategyId: allocation.strategyId,
      requestedCents: allocation.requestedCents,
      probabilityOfSuccess: probability,
      maxLossCents: maxLoss,
      expectedValueCents: probability !== null && expectedReturn !== null ? Math.round(probability * expectedReturn) : null,
      strategyRealizedProfitCents,
      factors,
    });
  }

  return ranked.sort((a, b) => {
    // Uncomputable expected value sorts last, unconditionally.
    if (a.expectedValueCents === null && b.expectedValueCents !== null) return 1;
    if (b.expectedValueCents === null && a.expectedValueCents !== null) return -1;
    if (a.expectedValueCents !== null && b.expectedValueCents !== null && a.expectedValueCents !== b.expectedValueCents) {
      return b.expectedValueCents - a.expectedValueCents;
    }
    // Then by recorded track record, then by the smaller ask — a cheaper test
    // of the same thesis is the better use of a limited experimental budget.
    if (a.strategyRealizedProfitCents !== b.strategyRealizedProfitCents) {
      return b.strategyRealizedProfitCents - a.strategyRealizedProfitCents;
    }
    return a.requestedCents - b.requestedCents;
  });
}

/**
 * Records a supervisor decision. An audit row, not an action.
 *
 * Exported so the API layer records the same shape the sweep does, rather than
 * inventing a second payload shape for the same kind of fact.
 */
export async function recordSupervisorDecision(input: {
  userId: string;
  decision: string;
  payload: Record<string, unknown>;
  correlationId: string;
}): Promise<void> {
  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.SUPERVISOR_DECISION,
    subjectType: "User",
    subjectId: input.userId,
    consequential: true,
    payload: { decision: input.decision, ...input.payload, correlationId: input.correlationId },
  });
}

/** Live requests with the treasury they would draw on. For the observer. */
export async function getSupervisorView(userId: string): Promise<{
  pending: CapitalAllocation[];
  ranked: RankedProposal[];
  availableCents: number;
  halted: boolean;
}> {
  const [pending, ranked, treasury] = await Promise.all([
    db.capitalAllocation.findMany({
      where: { userId, status: "REQUESTED" },
      orderBy: { requestedAt: "desc" },
      take: 50,
    }),
    rankCapitalProposals(userId),
    getTreasuryPosition(userId),
  ]);
  return { pending, ranked, availableCents: treasury.availableCents, halted: treasury.halted };
}
