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
import { getTreasuryPosition } from "@/lib/volara/treasury";
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

/**
 * [P4-G] One capital request awaiting a HUMAN, with everything needed to act on
 * it — and nothing that would let the Observer act on it itself.
 *
 * `runId`/`stepId` point at the EXISTING approval endpoint
 * (`POST /api/agents/[id]/steps/[stepId]/approve`). The Observer renders a link
 * to the canonical surface; it has no approval logic of its own, and adding any
 * would be the second authorization path §16 forbids.
 *
 * `argumentsHash` is deliberately ABSENT. The approval act re-derives it
 * server-side from the persisted step, so shipping it here would offer a value
 * a client might submit back instead of the one the server computed — exactly
 * the assertion-vs-evidence distinction P4-C2 turns on.
 */
export interface PendingApproval {
  allocationId: string;
  status: string;
  requestedCents: number;
  rationale: string;
  requestedAt: string;
  expiresAt: string;
  /** True once the request has expired and can no longer be approved at all. */
  expired: boolean;
  correlationId: string;
  agent: { id: string; name: string; role: string | null } | null;
  strategy: { id: string; name: string; status: string } | null;
  opportunity: { id: string; title: string; status: string } | null;
  /** The governor's verdict at request time. "PASS" is not an approval. */
  governorVerdict: string | null;
  governorReasons: string[];
  /** The bounds this request was measured against, as recorded then. */
  positionSnapshot: unknown;
  decisionRecord: unknown;
  /** Where the human acts. Null when the request has not been submitted yet. */
  runId: string | null;
  stepId: string | null;
  /** The canonical endpoint, so the UI never assembles an approval URL itself. */
  approvePath: string | null;
  rejectPath: string;
}

/**
 * [P4-G] What is dangerous, right now. Derived — no health column exists.
 *
 * Every field is a real condition with a real source, because a health panel
 * that invents a reassuring green is worse than no panel.
 */
export interface SystemHealth {
  halted: boolean;
  haltReason: string | null;
  agentCount: number;
  suspendedAgents: Array<{ id: string; name: string; reason: string | null; since: string | null }>;
  /** Agents holding a lease that has expired — a cycle that died mid-flight. */
  staleLeases: Array<{ id: string; name: string; expiredAt: string }>;
  /** Agents with a heartbeat older than the supervisor's stall threshold. */
  stalledAgents: Array<{ id: string; name: string; state: string; lastHeartbeatAt: string }>;
  /** Consequential failure events in the trailing window. */
  recentFailures: Array<{ id: string; type: string; subjectId: string | null; at: string }>;
  /** Refused escalation attempts. Non-zero here is a security event, not noise. */
  escalationRefusals: number;
  pendingApprovalCount: number;
  /** Reserved ÷ ceiling. Null when there is no ceiling to be under pressure of. */
  capitalPressure: number | null;
  /** Agents that ran a cycle inside the window. Zero means the runtime is idle. */
  agentsActiveRecently: number;
  /** The most recent cycle correlation id, when one has run. */
  latestCycleCorrelationId: string | null;
  windowHours: number;
}

/**
 * [P4-G] What the numbers on this screen ARE, stated rather than implied.
 *
 * The Observer's governing rule is that it must not pretend to know what the
 * runtime does not. These flags are how a UI renders "REALIZED DATA: NONE
 * RECORDED" as a fact it was told rather than as a zero it inferred.
 */
export interface ProvenanceState {
  /** Whether ANY revenue row exists with real (non-simulated) provenance. */
  realizedRevenueRecorded: boolean;
  realizedExpenseRecorded: boolean;
  /**
   * Whether VOX can currently confirm money against an external system of
   * record. Constantly false, and true only when a payment or banking
   * integration exists — see LedgerProvenance.REALIZED in the schema, which
   * nothing can write today. The Observer says so out loud.
   */
  externalConfirmationAvailable: boolean;
  externalConfirmationNote: string;
  /** Simulated ledger rows exist and are excluded from every figure shown. */
  simulatedEntriesExcludedCents: number;
}

export interface ObserverState {
  agents: ObservedAgent[];
  system: SystemMetrics;
  /** Everything currently reserved, requested or recently decided. */
  allocations: CapitalAllocation[];
  /** Live requests, ordered by recorded evidence. Advice, never authority. */
  rankedProposals: RankedProposal[];
  /** [P4-G] What is waiting on a person, ready to render as a decision queue. */
  pendingApprovals: PendingApproval[];
  strategies: Strategy[];
  /** The ledger rows currently in play. */
  opportunities: Opportunity[];
  messages: AgentMessage[];
  /** [P4-G] Derived danger state. */
  health: SystemHealth;
  /** [P4-G] What the figures mean, so the UI never implies more than it knows. */
  provenance: ProvenanceState;
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

/** Trailing window for "recent" in the health panel. */
export const HEALTH_WINDOW_HOURS = 24;

/** Heartbeat age after which an agent mid-stage counts as stalled. Matches the supervisor. */
const STALL_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * One snapshot of the entire runtime.
 *
 * Bounded everywhere it reads a list — 50 messages, 50 events, 100 rows — so a
 * long-running society does not turn the observer into an unbounded query.
 * Deeper history is reachable through the individual services, which paginate.
 */
export async function getVolaraObserverState(userId: string): Promise<ObserverState> {
  const [
    agentRows,
    system,
    allocations,
    rankedProposals,
    strategies,
    opportunities,
    messages,
    events,
    pendingApprovals,
    health,
    provenance,
  ] = await Promise.all([
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
    getPendingApprovals(userId),
    getSystemHealth(userId),
    getProvenanceState(userId),
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
    pendingApprovals,
    strategies,
    opportunities,
    messages,
    health,
    provenance,
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

/**
 * [P4-G] The human decision queue.
 *
 * Only `REQUESTED` rows, because those are the only ones a person can still
 * decide. An expired one is included and MARKED expired rather than hidden: a
 * request that quietly vanished from the queue is indistinguishable, to whoever
 * was going to answer it, from one that was silently approved.
 *
 * Nothing here is an approval and nothing here can become one. The paths are
 * the canonical existing endpoints, assembled once on the server so no UI
 * builds an approval URL by hand.
 */
export async function getPendingApprovals(userId: string): Promise<PendingApproval[]> {
  const rows = await db.capitalAllocation.findMany({
    where: { userId, status: "REQUESTED" },
    orderBy: { requestedAt: "desc" },
    take: 100,
    include: {
      agent: { select: { id: true, name: true, role: true } },
      strategy: { select: { id: true, name: true, status: true } },
      opportunity: { select: { id: true, title: true, status: true } },
    },
  });

  const now = Date.now();
  return rows.map((row) => ({
    allocationId: row.id,
    status: row.status,
    requestedCents: row.requestedCents,
    rationale: row.rationale,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now,
    correlationId: row.correlationId,
    agent: row.agent ? { id: row.agent.id, name: row.agent.name, role: row.agent.role } : null,
    strategy: row.strategy,
    opportunity: row.opportunity,
    governorVerdict: row.governorVerdict,
    governorReasons: parseStringArray(row.governorReasons),
    positionSnapshot: parseJsonValue(row.positionSnapshot),
    decisionRecord: parseJsonValue(row.decisionRecord),
    runId: row.runId,
    stepId: row.stepId,
    // The EXISTING approval endpoint — see step-approvals.ts, still the only
    // minter of grants in VOX. The Observer links to it; it does not reimplement it.
    approvePath:
      row.runId && row.stepId ? `/api/agents/${row.runId}/steps/${row.stepId}/approve` : null,
    rejectPath: `/api/volara/capital/${row.id}/reject`,
  }));
}

/**
 * [P4-G] Derived health. There is no health table and there should not be one.
 *
 * `Agent.health` exists as the runtime's own coarse observation, but the panel
 * needs conditions that no single column holds — a lease that expired without
 * being released, a heartbeat that stopped mid-stage, failures clustered in a
 * window — so they are computed here from rows that are already the truth.
 */
export async function getSystemHealth(userId: string): Promise<SystemHealth> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - HEALTH_WINDOW_HOURS * 60 * 60 * 1000);

  const [user, agents, failures, escalations, pendingCount, treasury, latestCycle] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { economicHaltedAt: true, economicHaltReason: true },
    }),
    db.agent.findMany({
      where: { userId, role: { not: null }, status: { not: "ARCHIVED" } },
      select: {
        id: true,
        name: true,
        runtimeState: true,
        heartbeatAt: true,
        lastActivityAt: true,
        suspendedAt: true,
        suspendedReason: true,
        leaseId: true,
        leaseExpiresAt: true,
        cycleCount: true,
      },
    }),
    db.event.findMany({
      where: {
        userId,
        consequential: true,
        createdAt: { gte: windowStart },
        type: { in: ["volara.cycle_failed", "agent.failure", "policy.execution_refused", "capital.refused"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, subjectId: true, createdAt: true },
    }),
    db.event.count({
      where: { userId, type: "volara.escalation_refused", createdAt: { gte: windowStart } },
    }),
    db.capitalAllocation.count({ where: { userId, status: "REQUESTED" } }),
    getTreasuryPosition(userId),
    db.agentStateTransition.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { correlationId: true },
    }),
  ]);

  return {
    halted: user.economicHaltedAt !== null,
    haltReason: user.economicHaltReason,
    agentCount: agents.length,
    suspendedAgents: agents
      .filter((agent) => agent.runtimeState === "SUSPENDED")
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        reason: agent.suspendedReason,
        since: agent.suspendedAt?.toISOString() ?? null,
      })),
    // A lease still held past its expiry means a cycle died without releasing.
    // Harmless — the next claim reclaims it — but it is real evidence of a
    // crash, so it is shown rather than quietly reclaimed.
    staleLeases: agents
      .filter((agent) => agent.leaseId !== null && agent.leaseExpiresAt !== null && agent.leaseExpiresAt <= now)
      .map((agent) => ({ id: agent.id, name: agent.name, expiredAt: agent.leaseExpiresAt!.toISOString() })),
    // Stalled needs all three: it has run before, it is not at rest, and it has
    // gone quiet. An agent that never ran is not stalled — it has not started.
    stalledAgents: agents
      .filter(
        (agent) =>
          agent.cycleCount > 0 &&
          agent.runtimeState !== "IDLE" &&
          agent.runtimeState !== "SUSPENDED" &&
          agent.runtimeState !== "PAUSED" &&
          agent.heartbeatAt !== null &&
          now.getTime() - agent.heartbeatAt.getTime() > STALL_THRESHOLD_MS
      )
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        state: agent.runtimeState,
        lastHeartbeatAt: agent.heartbeatAt!.toISOString(),
      })),
    recentFailures: failures.map((event) => ({
      id: event.id,
      type: event.type,
      subjectId: event.subjectId,
      at: event.createdAt.toISOString(),
    })),
    escalationRefusals: escalations,
    pendingApprovalCount: pendingCount,
    // Null, not zero: with no ceiling there is no pressure to be under, and a
    // 0% gauge would read as "plenty of room" when the truth is "no budget".
    capitalPressure:
      treasury.ceilingCents > 0 ? treasury.reservedCents / treasury.ceilingCents : null,
    agentsActiveRecently: agents.filter(
      (agent) => agent.lastActivityAt !== null && agent.lastActivityAt >= windowStart
    ).length,
    latestCycleCorrelationId: latestCycle?.correlationId ?? null,
    windowHours: HEALTH_WINDOW_HOURS,
  };
}

/**
 * [P4-G] What the money figures on this screen actually are.
 *
 * The point of this projection is the Observer's governing rule: if the runtime
 * does not know something, the UI must not imply it does. Without these flags a
 * revenue readout of `$0.00` is ambiguous between "we earned nothing" and "we
 * have no way to know" — and the second is the true one today, because
 * `LedgerProvenance.REALIZED` is unreachable: no payment or banking integration
 * exists, so nothing in VOX can confirm money against an external system of
 * record. `externalConfirmationAvailable` says so explicitly instead of leaving
 * a zero to be misread.
 */
export async function getProvenanceState(userId: string): Promise<ProvenanceState> {
  const [realRevenue, realExpense, simulatedRevenue, simulatedExpense, externallyConfirmed] = await Promise.all([
    db.economicRevenue.count({
      where: { asset: { userId }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
    }),
    db.economicExpense.count({
      where: { asset: { userId }, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
    }),
    db.economicRevenue.aggregate({
      where: { asset: { userId }, provenance: "SIMULATED" },
      _sum: { amountCents: true },
    }),
    db.economicExpense.aggregate({
      where: { asset: { userId }, provenance: "SIMULATED" },
      _sum: { amountCents: true },
    }),
    // Checked rather than asserted. It is currently impossible for this to be
    // non-zero — no writer exists — but reading it means the day one does, the
    // Observer starts telling the truth without anyone remembering to update it.
    db.economicRevenue.count({ where: { asset: { userId }, provenance: "REALIZED" } }),
  ]);

  return {
    realizedRevenueRecorded: realRevenue > 0,
    realizedExpenseRecorded: realExpense > 0,
    externalConfirmationAvailable: externallyConfirmed > 0,
    externalConfirmationNote:
      externallyConfirmed > 0
        ? "Some ledger entries are confirmed against an external system of record."
        : "No payment or banking integration exists, so no figure here is confirmed against an external system of record. Amounts shown are what VOX itself recorded.",
    simulatedEntriesExcludedCents:
      (simulatedRevenue._sum.amountCents ?? 0) + (simulatedExpense._sum.amountCents ?? 0),
  };
}

/** Parses a JSON string[] column defensively. A corrupt value reads as empty. */
function parseStringArray(raw: string | null): string[] {
  const value = parseJsonValue(raw);
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
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
