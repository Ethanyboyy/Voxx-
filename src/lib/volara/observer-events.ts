/**
 * [P4-G] The event vocabulary the Observer reacts to — client-safe.
 *
 * Separate from `timeline.ts` for one concrete reason: that module imports the
 * database client, so importing a constant from it drags SQLite into the
 * browser bundle. Constants that both sides need live here, where there is
 * nothing to drag.
 *
 * A frozen allowlist rather than "refetch on everything": VOX writes events
 * constantly — memory writes, chat turns, research items — and refetching the
 * Observer's projection on each of them would turn a busy session into a
 * self-inflicted load test for a screen none of it changes.
 */

export const OBSERVER_EVENT_TYPES: readonly string[] = Object.freeze([
  "agent.created",
  "agent.state_changed",
  "agent.state_refused",
  "agent.suspended",
  "agent.resumed",
  "agent.failure",
  "agent.message_sent",
  "agent.opportunity.discovered",
  "agent.opportunity.updated",
  "agent.opportunity.challenged",
  "strategy.proposed",
  "strategy.activated",
  "strategy.rejected",
  "strategy.paused",
  "strategy.killed",
  "strategy.completed",
  "strategy.replicated",
  "capital.requested",
  "capital.allocated",
  "capital.rejected",
  "capital.released",
  "capital.refused",
  "supervisor.decision",
  "volara.cycle_started",
  "volara.cycle_completed",
  "volara.cycle_failed",
  "volara.cycle_skipped",
  "volara.lesson_recorded",
  "volara.escalation_refused",
  "economic_asset.expense_logged",
  "policy.approval_approved",
  "policy.approval_rejected",
  "policy.approval_consumed",
  "policy.execution_refused",
]);

/** Whether a live event should cause the Observer to re-read its projection. */
export function isObserverEvent(type: string): boolean {
  return OBSERVER_EVENT_TYPES.includes(type);
}

/**
 * One decorated audit entry.
 *
 * Declared here rather than in `timeline.ts` so the client can type the JSON it
 * receives without importing the server module that produces it.
 */
export interface TimelineEntry {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  consequential: boolean;
  at: string;
  payload: unknown;
  agentId: string | null;
  strategyId: string | null;
  opportunityId: string | null;
  allocationId: string | null;
  correlationId: string | null;
  amountCents: number | null;
}
