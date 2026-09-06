/**
 * [P4-F] THE GLOBAL OBSERVER DATA CONTRACT.
 *
 * §17 asks for the underlying truth, not a visualization — the data a future
 * Global Observer will need in order to answer: what is every agent doing, why,
 * what does it believe, what is it pursuing, who suggested it, who challenged
 * it, what evidence supports it, how much capital is involved, what policy
 * allowed it, what actually happened, how much was made or lost, what was
 * learned, and what happens next.
 *
 * EVERY FIELD IS COMPUTED FROM REAL ROWS AT READ TIME. There is no cached
 * snapshot, no synthesized activity, and no field that is filled in when the
 * underlying data is absent — an unknown is `null`, and the consumer can tell
 * the difference between "zero" and "we do not know". A decorative observer
 * that always had something to show would be the fake visualization layer the
 * brief specifically rules out.
 *
 * `getCycleTrace()` is the forensic half. Given one correlation id it
 * reassembles everything that cycle produced across six tables, which is what
 * turns "why did Volara-4 ask for $23.14" into a single call.
 */

import { db } from "@/lib/db";
import { listRecentEvents } from "@/lib/observability/events";
import { getAgentMetrics, getSystemMetrics, type AgentMetrics, type SystemMetrics } from "@/lib/volara/metrics";
import { listRecentMessages } from "@/lib/volara/messages";
import { rankCapitalProposals, type RankedProposal } from "@/lib/volara/supervisor";
import { parseIdList } from "@/lib/volara/ledger";
import type {
  AgentMessage,
  AgentStateTransition,
  CapitalAllocation,
  Opportunity,
  Strategy,
} from "@/generated/prisma/client";

/** One agent, as the observer sees it. Identity, live state, derived economics. */
export interface ObservedAgent {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  /** Parsed persona config, or null when none was set. Never read by decisions. */
  persona: Record<string, unknown> | null;
  status: string;
  runtimeState: string;
  health: string;
  autonomyMode: string;
  /** Capability keys. The real allowlist, not a display label. */
  allowedCapabilities: string[];
  allowedTools: string[] | null;
  currentStage: string | null;
  currentRunId: string | null;
  currentObjective: { id: string; title: string } | null;
  /** The agent's own stated confidence, or null. Moves nothing. */
  confidence: number | null;
  heartbeatAt: string | null;
  lastActivityAt: string | null;
  nextWakeAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  maxRequestCents: number;
  createdAt: string;
  updatedAt: string;
  metrics: AgentMetrics | null;
  /** The most recent lifecycle transitions, so "why is it here" is answerable. */
  recentTransitions: Array<{
    from: string;
    to: string;
    reason: string;
    refused: boolean;
    correlationId: string;
    at: string;
  }>;
}

export interface ObserverState {
  agents: ObservedAgent[];
  system: SystemMetrics;
  /** Everything currently reserved, requested or recently decided. */
  allocations: CapitalAllocation[];
  /** Live requests, ordered by recorded evidence. Advice, never authority. */
  rankedProposals: RankedProposal[];
  strategies: Strategy[];
  /** The ledger rows currently in play. */
  opportunities: Opportunity[];
  messages: AgentMessage[];
  /** Recent consequential events across the whole runtime. */
  recentEvents: Array<{
    id: string;
    type: string;
    subjectType: string | null;
    subjectId: string | null;
    consequential: boolean;
    payload: unknown;
    at: string;
  }>;
  generatedAt: string;
}

/**
 * One snapshot of the entire runtime.
 *
 * Bounded everywhere it reads a list — 50 messages, 50 events, 100 rows — so a
 * long-running society does not turn the observer into an unbounded query.
 * Deeper history is reachable through the individual services, which paginate.
 */
export async function getVolaraObserverState(userId: string): Promise<ObserverState> {
  const [agentRows, system, allocations, rankedProposals, strategies, opportunities, messages, events] =
    await Promise.all([
      db.agent.findMany({
        where: { userId, role: { not: null } },
        orderBy: { name: "asc" },
        include: {
          currentObjective: { select: { id: true, title: true } },
          stateTransitions: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      }),
      getSystemMetrics(userId),
      db.capitalAllocation.findMany({ where: { userId }, orderBy: { requestedAt: "desc" }, take: 100 }),
      rankCapitalProposals(userId),
      db.strategy.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 100 }),
      db.opportunity.findMany({
        where: { userId, status: { notIn: ["REJECTED"] } },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      listRecentMessages(userId, 50),
      listRecentEvents(userId, 50),
    ]);

  const agents: ObservedAgent[] = [];
  for (const agent of agentRows) {
    agents.push({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      persona: parseJsonObject(agent.persona),
      status: agent.status,
      runtimeState: agent.runtimeState,
      health: agent.health,
      autonomyMode: agent.autonomyMode,
      allowedCapabilities: parseIdList(agent.allowedCapabilities),
      allowedTools: agent.allowedTools === null ? null : parseIdList(agent.allowedTools),
      currentStage: agent.currentStage,
      currentRunId: agent.currentRunId,
      currentObjective: agent.currentObjective,
      confidence: agent.confidence,
      heartbeatAt: agent.heartbeatAt?.toISOString() ?? null,
      lastActivityAt: agent.lastActivityAt?.toISOString() ?? null,
      nextWakeAt: agent.nextWakeAt?.toISOString() ?? null,
      suspendedAt: agent.suspendedAt?.toISOString() ?? null,
      suspendedReason: agent.suspendedReason,
      maxRequestCents: agent.maxRequestCents,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
      metrics: await getAgentMetrics(userId, agent.id),
      recentTransitions: agent.stateTransitions.map((transition) => ({
        from: transition.fromState,
        to: transition.toState,
        reason: transition.reason,
        refused: transition.refused,
        correlationId: transition.correlationId,
        at: transition.createdAt.toISOString(),
      })),
    });
  }

  return {
    agents,
    system,
    allocations,
    rankedProposals,
    strategies,
    opportunities,
    messages,
    recentEvents: events.map((event) => ({
      id: event.id,
      type: event.type,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      consequential: event.consequential,
      payload: parseJsonValue(event.payload),
      at: event.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export interface CycleTrace {
  correlationId: string;
  transitions: AgentStateTransition[];
  messages: AgentMessage[];
  allocations: CapitalAllocation[];
  opportunities: Opportunity[];
  strategies: Strategy[];
  /** Every agent run this cycle started, with its steps and their policy state. */
  runs: Array<{
    id: string;
    objective: string;
    status: string;
    strategyId: string | null;
    steps: Array<{
      id: string;
      order: number;
      toolName: string | null;
      status: string;
      capability: string | null;
      requiredLevel: string | null;
    }>;
  }>;
  /** Every event carrying this correlation id in its payload. */
  events: Array<{ id: string; type: string; consequential: boolean; payload: unknown; at: string }>;
}

/**
 * FORENSIC RECONSTRUCTION from one correlation id.
 *
 * The chain the brief asks for — objective → opportunity → strategy → run →
 * capital request → governor decision → policy decision → authorization →
 * execution → economic record → learning — is reassembled from the rows that
 * each carry the id, plus the events whose payloads carry it.
 *
 * The event scan uses a `contains` on the serialized payload rather than a
 * dedicated column. That is a deliberate trade: adding `correlationId` to
 * `Event` would touch every event writer in VOX for one query, and the payload
 * is already JSON that reliably contains the id where a Volara path wrote it.
 * The scan is bounded and this is a forensic path, not a hot one.
 */
export async function getCycleTrace(userId: string, correlationId: string): Promise<CycleTrace> {
  const [transitions, messages, allocations, opportunities, strategies, runs, events] = await Promise.all([
    db.agentStateTransition.findMany({ where: { userId, correlationId }, orderBy: { createdAt: "asc" } }),
    db.agentMessage.findMany({ where: { userId, correlationId }, orderBy: { createdAt: "asc" } }),
    db.capitalAllocation.findMany({ where: { userId, correlationId }, orderBy: { requestedAt: "asc" } }),
    db.opportunity.findMany({ where: { userId, correlationId }, orderBy: { createdAt: "asc" } }),
    db.strategy.findMany({ where: { userId, correlationId }, orderBy: { createdAt: "asc" } }),
    db.agentRun.findMany({
      where: { userId, correlationId },
      include: { steps: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.event.findMany({
      where: { userId, payload: { contains: correlationId } },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
  ]);

  return {
    correlationId,
    transitions,
    messages,
    allocations,
    opportunities,
    strategies,
    runs: runs.map((run) => ({
      id: run.id,
      objective: run.objective,
      status: run.status,
      strategyId: run.strategyId,
      steps: run.steps.map((step) => ({
        id: step.id,
        order: step.order,
        toolName: step.toolName,
        status: step.status,
        capability: step.capability,
        requiredLevel: step.requiredLevel,
      })),
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      consequential: event.consequential,
      payload: parseJsonValue(event.payload),
      at: event.createdAt.toISOString(),
    })),
  };
}

/**
 * The full economic chain behind one allocation.
 *
 * This is the "why did Volara-3 spend $23.14" query, answered from the
 * allocation outward: the agent that asked, the strategy and opportunity it
 * names, the run and step that carried it to a human, the grant that was spent,
 * and the ledger rows that resulted.
 */
export async function traceAllocation(userId: string, allocationId: string) {
  const allocation = await db.capitalAllocation.findFirst({
    where: { id: allocationId, userId },
    include: {
      agent: { select: { id: true, name: true, role: true } },
      strategy: true,
      opportunity: { include: { economicAsset: { select: { id: true } } } },
    },
  });
  if (!allocation) return null;

  const [grant, run, revenue, expenses] = await Promise.all([
    allocation.approvalGrantId
      ? db.approvalGrant.findFirst({ where: { id: allocation.approvalGrantId, userId } })
      : Promise.resolve(null),
    allocation.runId
      ? db.agentRun.findFirst({
          where: { id: allocation.runId, userId },
          include: { steps: { orderBy: { order: "asc" } } },
        })
      : Promise.resolve(null),
    allocation.opportunity?.economicAsset
      ? db.economicRevenue.findMany({ where: { assetId: allocation.opportunity.economicAsset.id } })
      : Promise.resolve([]),
    allocation.opportunity?.economicAsset
      ? db.economicExpense.findMany({ where: { assetId: allocation.opportunity.economicAsset.id } })
      : Promise.resolve([]),
  ]);

  return {
    allocation,
    agent: allocation.agent,
    strategy: allocation.strategy,
    opportunity: allocation.opportunity,
    governorVerdict: allocation.governorVerdict,
    governorReasons: parseJsonValue(allocation.governorReasons),
    decisionRecord: parseJsonValue(allocation.decisionRecord),
    positionSnapshot: parseJsonValue(allocation.positionSnapshot),
    // The authorization half: the grant a human spent, with what it was bound to.
    approval: grant
      ? {
          id: grant.id,
          actionId: grant.actionId,
          registry: grant.registry,
          policyDecision: grant.policyDecision,
          capability: grant.capability,
          requiredLevel: grant.requiredLevel,
          argumentsHash: grant.argumentsHash,
          classificationHash: grant.classificationHash,
          consumedAt: grant.consumedAt?.toISOString() ?? null,
          targetType: grant.targetType,
          targetId: grant.targetId,
        }
      : null,
    run,
    ledger: { revenue, expenses },
  };
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  const value = parseJsonValue(raw);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonValue(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A corrupt payload is reported as its raw text rather than dropped —
    // losing it would hide the fact that something wrote malformed JSON.
    return raw;
  }
}
