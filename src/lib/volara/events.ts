/**
 * [P4-F] The Volara runtime's event vocabulary.
 *
 * Constants rather than string literals scattered through the runtime, for one
 * reason that matters: a typo in an event type is invisible — the event still
 * writes, the observer just never sees it, and the audit trail has a hole
 * nobody notices. A frozen map makes a typo a compile error.
 *
 * These are recorded through the EXISTING `recordEvent()`
 * (src/lib/observability/events.ts), which also publishes onto the existing
 * live bus. No second event system was built, and nothing here publishes
 * directly — a path that reached `publishEvent()` without writing the row
 * would produce a live event with no durable record behind it.
 */

import { deepFreeze } from "@/lib/policy/classification";

export const VOLARA_EVENTS = deepFreeze({
  // Agent identity and lifecycle.
  AGENT_CREATED: "agent.created",
  AGENT_STARTED: "agent.started",
  AGENT_STATE_CHANGED: "agent.state_changed",
  /// An ILLEGAL transition was attempted and refused. Recorded because a
  /// refused transition is evidence, not a no-op.
  AGENT_STATE_REFUSED: "agent.state_refused",
  AGENT_HEARTBEAT: "agent.heartbeat",
  AGENT_FAILURE: "agent.failure",
  AGENT_SUSPENDED: "agent.suspended",
  AGENT_RESUMED: "agent.resumed",

  // Communication. Sending a message is NOT consequential — it authorizes
  // nothing — so these are recorded with `consequential: false`.
  MESSAGE_SENT: "agent.message_sent",
  MESSAGE_READ: "agent.message_read",

  // The shared ledger.
  OPPORTUNITY_DISCOVERED: "agent.opportunity.discovered",
  OPPORTUNITY_UPDATED: "agent.opportunity.updated",
  OPPORTUNITY_CHALLENGED: "agent.opportunity.challenged",

  // Strategy.
  STRATEGY_PROPOSED: "strategy.proposed",
  STRATEGY_ACTIVATED: "strategy.activated",
  STRATEGY_REJECTED: "strategy.rejected",
  STRATEGY_PAUSED: "strategy.paused",
  STRATEGY_KILLED: "strategy.killed",
  STRATEGY_COMPLETED: "strategy.completed",
  STRATEGY_REPLICATED: "strategy.replicated",

  // Capital. Every one of these is consequential: they move, reserve or free
  // real budget, or record that a request to do so was refused.
  CAPITAL_REQUESTED: "capital.requested",
  CAPITAL_ALLOCATED: "capital.allocated",
  CAPITAL_REJECTED: "capital.rejected",
  CAPITAL_RELEASED: "capital.released",
  CAPITAL_REFUSED: "capital.refused",

  // Supervision.
  SUPERVISOR_DECISION: "supervisor.decision",

  // The runtime loop.
  CYCLE_STARTED: "volara.cycle_started",
  CYCLE_COMPLETED: "volara.cycle_completed",
  CYCLE_FAILED: "volara.cycle_failed",
  CYCLE_SKIPPED: "volara.cycle_skipped",

  // Learning.
  LESSON_RECORDED: "volara.lesson_recorded",

  /**
   * AN AGENT TRIED TO ESCALATE ITS OWN PRIVILEGE, AND WAS REFUSED.
   *
   * Consequential, loudly. The P4-F brief requires every escalation attempt to
   * be "observable and rejected"; this is the observable half, and
   * `screenAgentIntent()` is the rejected half.
   */
  ESCALATION_REFUSED: "volara.escalation_refused",
} as const);

export type VolaraEventType = (typeof VOLARA_EVENTS)[keyof typeof VOLARA_EVENTS];
