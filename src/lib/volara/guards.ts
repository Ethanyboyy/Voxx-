/**
 * [P4-F] NO SELF-PRIVILEGE-ESCALATION.
 *
 * The hard invariant of this phase: no agent may modify its own or another
 * agent's capabilities, modify policy rules or approval requirements, grant
 * itself capital, modify treasury balances, erase economic or audit history,
 * disable enforcement or logging, promote itself to a higher autonomy mode, or
 * create an authorization for itself.
 *
 * THIS FILE IS THE SECOND LAYER, NOT THE FIRST.
 *
 * The first layer is structural and stronger: `src/lib/volara/` never imports
 * `grantPermission`, `createApprovalGrant` or `consumeApprovalGrant`, and no
 * module in it writes to `Permission`, `ApprovalGrant`, or the governing `User`
 * columns (`maxAutonomousSpendUsd`, `economicHaltedAt`, `autonomyMode`), or to
 * an `Agent`'s `allowedCapabilities` / `allowedTools` / `autonomyMode` /
 * `maxRequestCents`. `tests/volara-authority.test.ts` walks the directory and
 * fails the suite on any of them. A runtime check can be reached around; an
 * absent import cannot.
 *
 * So why have a runtime layer at all? Because the structural test proves what
 * the code does NOT do, and this proves what happens when something TRIES. The
 * brief requires an attempt to be "observable and rejected", and a refusal that
 * leaves no trace is only half of that. Every refusal here writes a
 * consequential `volara.escalation_refused` event and suspends the agent, so an
 * escalation attempt becomes evidence rather than a silent no-op.
 *
 * NOTHING HERE IS AN AUTHORIZATION CHECK. It never says yes — it only ever says
 * no, or nothing. Authorization remains exclusively `enforceCapability()` and
 * `enforceExecution()`. A guard that could permit would be the second
 * permission system the brief forbids.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import { deepFreeze } from "@/lib/policy/classification";
import { VOLARA_EVENTS } from "@/lib/volara/events";

/**
 * The CLOSED set of things a Volara agent may originate.
 *
 * Modelled on the proposal engine's closed `ACTION_HANDLERS` map
 * (src/lib/cognition/proposals.ts) for the same reason it is closed there: an
 * open set means the next contributor's addition is authorized by default. An
 * intent that is not in this list is refused, not merely unhandled.
 *
 * Every one of these writes a PROPOSAL. None of them causes a side effect
 * outside VOX, none spends, and the only one that can lead to money moving
 * (`REQUEST_CAPITAL`) produces a row in `REQUESTED` that a human must approve
 * through the existing ApprovalGrant path.
 */
export const VOLARA_INTENTS = deepFreeze([
  /** Write an Opportunity row, or update the ledger fields of one. */
  "RECORD_OPPORTUNITY",
  "UPDATE_OPPORTUNITY",
  /** Send an AgentMessage. Authorizes nothing — see AgentMessage's docstring. */
  "SEND_MESSAGE",
  /** Draft or propose a Strategy. Never activate one. */
  "DRAFT_STRATEGY",
  "PROPOSE_STRATEGY",
  /** Ask a human for capital. Produces a REQUESTED row and nothing else. */
  "REQUEST_CAPITAL",
  /** Give back an unspent reservation. Can only ever free capital. */
  "RELEASE_CAPITAL",
  /** Record a lesson against a strategy the agent owns. */
  "RECORD_LESSON",
  /** Update the agent's own runtime bookkeeping (stage, confidence, heartbeat). */
  "UPDATE_OWN_RUNTIME",
] as const);

export type VolaraIntent = (typeof VOLARA_INTENTS)[number];

/**
 * Entity types an agent may never write, by name.
 *
 * Names, not table handles, because the check is a tripwire on the INTENT: code
 * that actually reached one of these tables would already have had to import
 * something this directory does not import. Listing them keeps the prohibited
 * set reviewable in a diff rather than implied by absence.
 */
export const PROTECTED_TARGETS = deepFreeze([
  /** Who may do what. The only source of authorization truth. */
  "Permission",
  /** Human consent. Minting one is `step-approvals.ts`'s alone. */
  "ApprovalGrant",
  /** The audit trail. Append-only; nothing may erase it. */
  "Event",
  /** The capability trace. Same reason. */
  "CapabilityRun",
  /** The spend ceiling, the global halt, and the account autonomy default. */
  "User",
  /** The policy classification table and the matrix. */
  "ActionClassification",
  "PolicyMatrix",
  /** Another agent's identity row. An agent may only ever write its own. */
  "AgentCapabilities",
  /** Realized accounting. Immutable history. */
  "EconomicRevenue",
  "EconomicExpense",
] as const);

export type ProtectedTarget = (typeof PROTECTED_TARGETS)[number];

/** Why a screening refused. Codes, so no caller parses prose. */
export type EscalationRefusal =
  | "UNKNOWN_INTENT"
  | "PROTECTED_TARGET"
  | "CROSS_AGENT_MUTATION"
  | "AGENT_SUSPENDED"
  | "AGENT_NOT_FOUND";

export interface AgentIntentScreening {
  userId: string;
  /** The agent originating this. Always the acting agent's OWN id. */
  agentId: string;
  intent: string;
  /**
   * What the intent would write. `targetType` is compared against
   * {@link PROTECTED_TARGETS}; `targetAgentId`, when present, must equal
   * `agentId` — an agent acting on another agent is refused outright.
   */
  targetType?: string;
  targetId?: string;
  targetAgentId?: string;
  correlationId: string;
}

export type ScreeningResult = { allowed: true } | { allowed: false; reason: EscalationRefusal };

/**
 * Thrown when an agent-originated write is refused. A throw rather than a
 * return value at the call sites that must not continue: a caller that ignored
 * a returned refusal would perform the write anyway, and this is the one class
 * of mistake this module exists to make impossible.
 */
export class EscalationRefusedError extends Error {
  constructor(
    readonly reason: EscalationRefusal,
    readonly intent: string,
    message: string
  ) {
    super(message);
    this.name = "EscalationRefusedError";
  }
}

/**
 * Screens one agent-originated write BEFORE it happens.
 *
 * Order is deliberate. The cheapest, most absolute checks run first, and a
 * refusal never falls through to a later branch that could permit:
 *
 *   1. The intent must be in the closed set. An unrecognised intent is refused
 *      rather than passed along — "we have not thought about this one" is not
 *      a reason to allow it.
 *   2. The target type must not be protected.
 *   3. The target agent, when there is one, must be the acting agent itself.
 *   4. The acting agent must exist, belong to this user, and not be suspended.
 *
 * A suspended agent is refused here as well as in the scheduler, because a
 * scheduler-only check would let anything that calls the runtime directly —
 * an API route, a test, a future caller — act on a suspended agent.
 */
export async function screenAgentIntent(input: AgentIntentScreening): Promise<ScreeningResult> {
  if (!(VOLARA_INTENTS as readonly string[]).includes(input.intent)) {
    await recordEscalationRefusal(input, "UNKNOWN_INTENT");
    return { allowed: false, reason: "UNKNOWN_INTENT" };
  }

  if (input.targetType && (PROTECTED_TARGETS as readonly string[]).includes(input.targetType)) {
    await recordEscalationRefusal(input, "PROTECTED_TARGET");
    return { allowed: false, reason: "PROTECTED_TARGET" };
  }

  if (input.targetAgentId && input.targetAgentId !== input.agentId) {
    await recordEscalationRefusal(input, "CROSS_AGENT_MUTATION");
    return { allowed: false, reason: "CROSS_AGENT_MUTATION" };
  }

  const agent = await db.agent.findFirst({
    where: { id: input.agentId, userId: input.userId },
    select: { id: true, runtimeState: true },
  });
  if (!agent) {
    await recordEscalationRefusal(input, "AGENT_NOT_FOUND");
    return { allowed: false, reason: "AGENT_NOT_FOUND" };
  }
  if (agent.runtimeState === "SUSPENDED" || agent.runtimeState === "PAUSED") {
    await recordEscalationRefusal(input, "AGENT_SUSPENDED");
    return { allowed: false, reason: "AGENT_SUSPENDED" };
  }

  return { allowed: true };
}

/** {@link screenAgentIntent}, as a throw. Use at sites that must not continue. */
export async function assertAgentIntentAllowed(input: AgentIntentScreening): Promise<void> {
  const result = await screenAgentIntent(input);
  if (!result.allowed) {
    throw new EscalationRefusedError(
      result.reason,
      input.intent,
      `Agent ${input.agentId} may not "${input.intent}"${input.targetType ? ` on ${input.targetType}` : ""}: ${result.reason}.`
    );
  }
}

/**
 * Records the attempt and, for a genuine escalation, stops the agent.
 *
 * The distinction matters. `AGENT_SUSPENDED` and `AGENT_NOT_FOUND` are states,
 * not attacks — an already-suspended agent being refused is the suspension
 * working. `UNKNOWN_INTENT`, `PROTECTED_TARGET` and `CROSS_AGENT_MUTATION` are
 * an agent reaching for something it must never reach for, and an agent that
 * did that once will do it again on the next cycle, so it stops until a human
 * looks at it.
 *
 * Never throws. The refusal has already been decided by the caller; losing the
 * audit line must not turn a refusal into a permit.
 */
async function recordEscalationRefusal(input: AgentIntentScreening, reason: EscalationRefusal): Promise<void> {
  const isEscalation =
    reason === "UNKNOWN_INTENT" || reason === "PROTECTED_TARGET" || reason === "CROSS_AGENT_MUTATION";
  try {
    await recordEvent({
      userId: input.userId,
      type: VOLARA_EVENTS.ESCALATION_REFUSED,
      subjectType: "Agent",
      subjectId: input.agentId,
      // Consequential: this is the runtime changing what an agent did, which is
      // exactly what the consequential feed exists to surface.
      consequential: true,
      payload: {
        intent: input.intent,
        reason,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetAgentId: input.targetAgentId ?? null,
        correlationId: input.correlationId,
        suspended: isEscalation,
      },
    });

    if (isEscalation) {
      await db.agent.updateMany({
        where: { id: input.agentId, userId: input.userId, runtimeState: { not: "SUSPENDED" } },
        data: {
          runtimeState: "SUSPENDED",
          health: "UNHEALTHY",
          suspendedAt: new Date(),
          suspendedReason: `Refused escalation: ${reason} (${input.intent})`,
        },
      });
      await recordEvent({
        userId: input.userId,
        type: VOLARA_EVENTS.AGENT_SUSPENDED,
        subjectType: "Agent",
        subjectId: input.agentId,
        consequential: true,
        payload: { reason: `ESCALATION_${reason}`, correlationId: input.correlationId },
      });
    }
  } catch (error) {
    logger.error("volara.escalation_record_failed", {
      agentId: input.agentId,
      intent: input.intent,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
