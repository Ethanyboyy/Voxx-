/**
 * [P6-G] DISPATCHING A DECLARED INTERVENTION, DETERMINISTICALLY.
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES, AND IT IS NARROW
 * ---------------------------------------------------------------------------
 *
 * P5-G built the write path and P6-F bound it to an experiment, and between
 * them every gate exists: `integration.shopify.write` at ACT, a policy HOLD, an
 * argument-bound `ApprovalGrant`, a unique execution identity, a three-outcome
 * write port. What did not exist was a way for an operator to put a declared
 * action in front of those gates. The only HTTP route into the executor is
 * `POST /api/agents`, which hands an objective to a PLANNER — so conducting a
 * real intervention meant hoping a model chose `commerce.create_discount_code`
 * and then typed the right `actionId` and the right 64-hex `contractDigest`
 * into it. The P6-F tests build the run by hand, which is why they could run at
 * all and the application could not.
 *
 * So the live path was architecturally complete and OPERATIONALLY unreachable,
 * and that is a safety problem rather than a convenience one: the arguments to
 * the one write tool in VOX should be derived from the frozen row, not composed
 * by a language model.
 *
 * ---------------------------------------------------------------------------
 * IT ADDS NO AUTHORITY WHATSOEVER
 * ---------------------------------------------------------------------------
 *
 * This is the same shape as P5-D's `requestExperimentExecution()`: build one
 * run with one step bound to one tool, hand it to the EXISTING `executeRun()`,
 * and report where it parked. Specifically it does NOT:
 *
 *   - call `executeCommercialAction()` — the tool does, through the executor
 *   - call `enforceCapability()`, `grantPermission()` or `createApprovalGrant()`
 *   - evaluate the policy gate or read an `ApprovalGrant`
 *   - perform any `fetch`
 *
 * A dispatch by an account that has not granted `integration.shopify.write` at
 * ACT parks at WAITING_FOR_PERMISSION and sends nothing. **THAT IS A SUCCESSFUL
 * DISPATCH**, reported as `waiting`, for the same reason P5-D reports it that
 * way: a run that correctly stopped to ask a person is not an error, and
 * returning it as one teaches an operator to retry past the gate.
 *
 * The step input is `{ actionId, contractDigest }` read off the action row. The
 * caller supplies neither. The digest is in the arguments because the executor
 * hashes validated arguments into the grant, so a parameter edited between
 * approval and execution changes the digest, changes the hash, and the grant
 * stops matching — see the tool registration.
 */

import { db } from "@/lib/db";
import { createAgentRun, cancelAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { recordEvent } from "@/lib/observability/events";
import { CREATE_DISCOUNT_TOOL } from "@/lib/commerce/execute";

export type DispatchInterventionRefusal =
  | "NOT_FOUND"
  /**
   * The action is not PLANNED.
   *
   * SUBMITTED, SUCCEEDED, FAILED and UNKNOWN are all refused, and UNKNOWN is
   * the one that matters: VOX does not know that nothing exists, so it must not
   * act as though nothing does. `executeCommercialAction()` refuses these too —
   * this is an early refusal, not the only one, and deliberately not a
   * replacement for it.
   */
  | "NOT_PLANNABLE"
  /** The action already has an execution identity. One action, one execution. */
  | "ALREADY_DISPATCHED"
  /** Another dispatch claimed the run first. Nothing was executed twice. */
  | "DISPATCH_RACE_LOST";

export type DispatchInterventionResult =
  | {
      dispatched: true;
      runId: string;
      stepId: string;
      /** Where the run came to rest. `WAITING_FOR_PERMISSION` is the correct resting state. */
      runStatus: string;
      /** The action's status after the executor returned: still PLANNED when it parked. */
      actionStatus: string;
      /** Present only when the store actually created something. */
      externalId: string | null;
    }
  | { dispatched: false; reason: DispatchInterventionRefusal; detail: string };

/**
 * Puts one declared, frozen intervention in front of the existing gates.
 *
 * Returns where it stopped. Nothing here decides whether it may proceed.
 */
export async function dispatchIntervention(
  userId: string,
  actionId: string
): Promise<DispatchInterventionResult> {
  const action = await db.commercialAction.findFirst({ where: { id: actionId, userId } });
  if (!action) {
    return { dispatched: false, reason: "NOT_FOUND", detail: "No such commercial action." };
  }
  if (action.executionRunId !== null) {
    return {
      dispatched: false,
      reason: "ALREADY_DISPATCHED",
      detail: "This action already has an execution identity. An action is executed once, so that 'the execution' is never ambiguous.",
    };
  }
  if (action.status !== "PLANNED") {
    return {
      dispatched: false,
      reason: "NOT_PLANNABLE",
      detail:
        action.status === "UNKNOWN"
          ? "This action's outcome is UNKNOWN — it may already exist in the store. Ask the store (observeCommercialAction) before considering another attempt."
          : `This action is ${action.status}, so there is nothing to dispatch.`,
    };
  }

  // ONE step, bound to the one write tool, with arguments read off the frozen
  // row. No planner chooses the tool and no caller supplies the digest.
  const run = await createAgentRun({
    userId,
    objective: `Execute declared commercial intervention in ${action.externalScope}`,
    steps: [
      {
        description: `Create the authorized discount code declared by action ${action.id}`,
        toolName: CREATE_DISCOUNT_TOOL,
        input: { actionId: action.id, contractDigest: action.contractDigest },
      },
    ],
  });

  const step = await db.agentStep.findFirst({ where: { runId: run.id }, orderBy: { order: "asc" } });
  if (!step) {
    await cancelAgentRun(userId, run.id).catch(() => {});
    return { dispatched: false, reason: "DISPATCH_RACE_LOST", detail: "The run was created without its step." };
  }

  await recordEvent({
    userId,
    type: "economic.intervention.dispatched",
    subjectType: "CommercialAction",
    subjectId: action.id,
    consequential: true,
    payload: {
      agentRunId: run.id,
      agentStepId: step.id,
      toolName: CREATE_DISCOUNT_TOOL,
      externalScope: action.externalScope,
      experimentId: action.experimentId,
      note: "Dispatch is not authorization. The step is a HOLD and requires an argument-bound ApprovalGrant before anything is sent.",
    },
  });

  // The existing executor, called exactly as every other caller calls it. It
  // performs the capability check and the policy enforcement; a park at
  // WAITING_FOR_PERMISSION is the expected outcome on a first dispatch.
  const executed = await executeRun(userId, run.id);

  // Re-read rather than infer. Whether the write happened is a fact about the
  // row, and `executeCommercialAction()` is the only thing that writes it.
  const after = await db.commercialAction.findFirst({
    where: { id: actionId, userId },
    select: { status: true, externalId: true },
  });

  return {
    dispatched: true,
    runId: run.id,
    stepId: step.id,
    runStatus: executed.status,
    actionStatus: after?.status ?? action.status,
    externalId: after?.externalId ?? null,
  };
}
