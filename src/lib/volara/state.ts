/**
 * [P4-F] THE AGENT LIFECYCLE, AS AN ACTUAL MACHINE.
 *
 * `Agent.runtimeState` is a column, and a column alone can say where an agent
 * is but not that it got there legally. This module supplies the missing half:
 * a frozen table of legal edges, one function that is the only writer of the
 * column, and an `AgentStateTransition` row for every attempt — including the
 * refused ones, because an attempted illegal transition is evidence, not a
 * no-op.
 *
 * THE TRANSITION IS A COMPARE-AND-SWAP. `transitionAgent()` names the state it
 * believes the agent is in inside the `WHERE` clause, so two concurrent cycles
 * cannot both move the same agent: the loser updates zero rows and is told so.
 * A read-then-write pair would have a window between the legality check and the
 * write in which the state moved, which is the same TOCTOU shape
 * `consumeApprovalGrant()` and `recordPolicySpend()` avoid the same way.
 *
 * SUSPENDED IS A TRAP DOOR. Nothing in the runtime can leave it. The only edge
 * out is `HUMAN_RESUME`, and `resumeAgent()` is the only caller allowed to use
 * it — an agent that could resume itself would make suspension advisory.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import { deepFreeze } from "@/lib/policy/classification";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import type { AgentRuntimeState } from "@/generated/prisma/enums";

/**
 * The legal edges. Read as: from this state, an agent may move to these.
 *
 * Shaped by the runtime loop's real stages, not by a diagram: OBSERVE →
 * DISCOVER/ANALYZE → PROPOSE → AUTHORIZE → EXECUTE → REPORT → LEARN → IDLE,
 * with two escapes available from anywhere the loop can be (FAILED, and a
 * human PAUSE).
 *
 * FAILED can only go to SUSPENDED or IDLE — never straight back into work,
 * because a failed cycle that immediately re-entered the loop is the retry
 * storm the failure counters exist to stop.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<AgentRuntimeState, readonly AgentRuntimeState[]>> = deepFreeze({
  IDLE: ["THINKING", "RESEARCHING", "PAUSED", "FAILED", "SUSPENDED"],
  THINKING: ["RESEARCHING", "EVALUATING", "PROPOSING", "REPORTING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  RESEARCHING: ["EVALUATING", "THINKING", "REPORTING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  EVALUATING: ["PROPOSING", "THINKING", "REPORTING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  PROPOSING: ["WAITING_FOR_AUTHORIZATION", "REPORTING", "LEARNING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  // The one edge a human stands on. An agent parked here is waiting on a
  // person, and EXECUTING is reachable only once that person has approved —
  // which the enforcement layer, not this table, decides.
  WAITING_FOR_AUTHORIZATION: ["EXECUTING", "REPORTING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  EXECUTING: ["REPORTING", "LEARNING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  REPORTING: ["LEARNING", "IDLE", "PAUSED", "FAILED", "SUSPENDED"],
  LEARNING: ["IDLE", "REPORTING", "PAUSED", "FAILED", "SUSPENDED"],
  PAUSED: ["IDLE", "SUSPENDED"],
  FAILED: ["IDLE", "SUSPENDED"],
  // The trap door. Only resumeAgent() may take an agent out of here.
  SUSPENDED: ["IDLE"],
} as const);

export function isLegalTransition(from: AgentRuntimeState, to: AgentRuntimeState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

export type TransitionRefusal = "AGENT_NOT_FOUND" | "ILLEGAL_TRANSITION" | "STATE_MOVED" | "SUSPENDED_LOCKED";

export type TransitionResult =
  | { transitioned: true; from: AgentRuntimeState; to: AgentRuntimeState }
  | { transitioned: false; reason: TransitionRefusal; from: AgentRuntimeState | null };

export interface TransitionInput {
  userId: string;
  agentId: string;
  to: AgentRuntimeState;
  /** A short machine code, e.g. "CYCLE_START". Never model prose. */
  reason: string;
  correlationId: string;
  /**
   * Only `resumeAgent()` passes this. It is the single key to the one edge out
   * of SUSPENDED, and it exists so that "a human lifted this" is a distinct,
   * greppable fact rather than an ordinary transition that happens to land on
   * IDLE.
   */
  humanResume?: boolean;
  /** Extra columns to write in the same statement as the state change. */
  patch?: {
    health?: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "STALLED" | "UNHEALTHY";
    currentStage?: string | null;
    currentRunId?: string | null;
    heartbeatAt?: Date;
    lastActivityAt?: Date;
    nextWakeAt?: Date | null;
    suspendedAt?: Date | null;
    suspendedReason?: string | null;
  };
}

/**
 * Moves an agent, or refuses and says why. THE ONLY WRITER of `runtimeState`.
 *
 * Every outcome — moved, illegal, lost the race — writes an
 * `AgentStateTransition` row. The refused ones carry `refused: true`, which is
 * what turns "someone tried to jump straight from IDLE to EXECUTING" from an
 * absence of evidence into a record of an attempt.
 */
export async function transitionAgent(input: TransitionInput): Promise<TransitionResult> {
  const agent = await db.agent.findFirst({
    where: { id: input.agentId, userId: input.userId },
    select: { id: true, runtimeState: true },
  });
  if (!agent) return { transitioned: false, reason: "AGENT_NOT_FOUND", from: null };

  const from = agent.runtimeState;

  // The trap door, checked before the table so the refusal reason is the
  // specific one. Leaving SUSPENDED is legal exactly once — for a human.
  if (from === "SUSPENDED" && !input.humanResume) {
    await recordTransition(input, from, true, "SUSPENDED_LOCKED");
    return { transitioned: false, reason: "SUSPENDED_LOCKED", from };
  }

  if (!isLegalTransition(from, input.to)) {
    await recordTransition(input, from, true, "ILLEGAL_TRANSITION");
    return { transitioned: false, reason: "ILLEGAL_TRANSITION", from };
  }

  // COMPARE-AND-SWAP. `runtimeState: from` in the WHERE is the whole race
  // guarantee: if another cycle moved this agent between the read above and
  // this write, zero rows update and this transition refuses rather than
  // overwriting a state it never evaluated.
  const moved = await db.agent.updateMany({
    where: { id: input.agentId, userId: input.userId, runtimeState: from },
    data: {
      runtimeState: input.to,
      lastActivityAt: input.patch?.lastActivityAt ?? new Date(),
      ...(input.patch?.health !== undefined ? { health: input.patch.health } : {}),
      ...(input.patch?.currentStage !== undefined ? { currentStage: input.patch.currentStage } : {}),
      ...(input.patch?.currentRunId !== undefined ? { currentRunId: input.patch.currentRunId } : {}),
      ...(input.patch?.heartbeatAt !== undefined ? { heartbeatAt: input.patch.heartbeatAt } : {}),
      ...(input.patch?.nextWakeAt !== undefined ? { nextWakeAt: input.patch.nextWakeAt } : {}),
      ...(input.patch?.suspendedAt !== undefined ? { suspendedAt: input.patch.suspendedAt } : {}),
      ...(input.patch?.suspendedReason !== undefined ? { suspendedReason: input.patch.suspendedReason } : {}),
    },
  });

  if (moved.count !== 1) {
    await recordTransition(input, from, true, "STATE_MOVED");
    return { transitioned: false, reason: "STATE_MOVED", from };
  }

  await recordTransition(input, from, false);
  return { transitioned: true, from, to: input.to };
}

/**
 * Writes the transition row and its event. Never throws: the state change has
 * already happened (or already been refused), and losing the record must not
 * undo it.
 */
async function recordTransition(
  input: TransitionInput,
  from: AgentRuntimeState,
  refused: boolean,
  refusalReason?: TransitionRefusal
): Promise<void> {
  try {
    await db.agentStateTransition.create({
      data: {
        userId: input.userId,
        agentId: input.agentId,
        fromState: from,
        toState: input.to,
        reason: refused ? `REFUSED_${refusalReason}:${input.reason}` : input.reason,
        refused,
        correlationId: input.correlationId,
      },
    });
    await recordEvent({
      userId: input.userId,
      type: refused ? VOLARA_EVENTS.AGENT_STATE_REFUSED : VOLARA_EVENTS.AGENT_STATE_CHANGED,
      subjectType: "Agent",
      subjectId: input.agentId,
      // A refused transition is the runtime stopping something; that is
      // consequential in the same sense a refused execution is.
      consequential: refused,
      payload: {
        from,
        to: input.to,
        reason: input.reason,
        refusalReason: refusalReason ?? null,
        correlationId: input.correlationId,
      },
    });
  } catch (error) {
    logger.error("volara.transition_record_failed", {
      agentId: input.agentId,
      from,
      to: input.to,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** How many consecutive failed cycles before an agent stops scheduling itself. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Stops an agent. Called by the runtime on repeated failure and by the
 * supervisor on an unhealthy one — never by the agent about itself, and never
 * by one agent about another (`screenAgentIntent()` refuses that).
 *
 * Deliberately NOT routed through `transitionAgent()`'s legality table: every
 * state may go to SUSPENDED, and a suspension that could be refused because the
 * agent happened to be mid-stage would be a suspension that does not work.
 */
export async function suspendAgent(
  userId: string,
  agentId: string,
  reason: string,
  correlationId: string
): Promise<boolean> {
  const suspended = await db.agent.updateMany({
    where: { id: agentId, userId, runtimeState: { not: "SUSPENDED" } },
    data: {
      runtimeState: "SUSPENDED",
      health: "UNHEALTHY",
      suspendedAt: new Date(),
      suspendedReason: reason,
      leaseId: null,
      leaseExpiresAt: null,
    },
  });
  if (suspended.count !== 1) return false;

  await db.agentStateTransition.create({
    data: {
      userId,
      agentId,
      // The prior state is not re-read here on purpose: the update above is the
      // authoritative moment, and a second read could report a state that has
      // since moved. SUSPENDED is recorded as reached, from wherever it was.
      fromState: "FAILED",
      toState: "SUSPENDED",
      reason,
      correlationId,
    },
  });
  await recordEvent({
    userId,
    type: VOLARA_EVENTS.AGENT_SUSPENDED,
    subjectType: "Agent",
    subjectId: agentId,
    consequential: true,
    payload: { reason, correlationId },
  });
  return true;
}

/**
 * The human act that lifts a suspension. The only path out of SUSPENDED.
 *
 * Resets `consecutiveFailures` — not `failureCount`, which is lifetime history
 * and must survive, because deleting the record of past failures to make an
 * agent look healthy is exactly what §21 means by "do not silently delete
 * failed runs".
 */
export async function resumeAgent(userId: string, agentId: string, correlationId: string): Promise<TransitionResult> {
  const result = await transitionAgent({
    userId,
    agentId,
    to: "IDLE",
    reason: "HUMAN_RESUME",
    correlationId,
    humanResume: true,
    patch: { health: "UNKNOWN", suspendedAt: null, suspendedReason: null, nextWakeAt: null },
  });
  if (!result.transitioned) return result;

  await db.agent.updateMany({
    where: { id: agentId, userId },
    data: { consecutiveFailures: 0, leaseId: null, leaseExpiresAt: null },
  });
  await recordEvent({
    userId,
    type: VOLARA_EVENTS.AGENT_RESUMED,
    subjectType: "Agent",
    subjectId: agentId,
    consequential: true,
    payload: { correlationId },
  });
  return result;
}
