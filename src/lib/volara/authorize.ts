/**
 * [P4-F] THE AUTHORIZATION HANDOFF.
 *
 * A `CapitalAllocation` in `REQUESTED` is an agent asking. Turning it into a
 * reservation needs a human, and this module is the two lines that hand it to
 * one — by creating exactly what the agent framework would create for any other
 * held action: a ONE-STEP `AgentRun` whose tool is `volara.allocate_capital`.
 *
 * NOTHING NEW HAPPENS FROM HERE. Everything P4-B/C/D/E built applies unchanged:
 *
 *   startAgentRun()            persists the run and its single step
 *   executor                   finalizes the arguments and hashes them
 *   enforceExecution()         classification → HOLD → no grant → park
 *   step-approvals.ts          the human's act, the ONLY minter of grants
 *   consumeApprovalGrant()     single-use compare-and-swap
 *   withEnforcedExecution()    the scope the sink guard checks for
 *   approveCapitalAllocation() the atomic reservation
 *
 * This mirrors what `POST /api/research` does (P4-D): rather than building a
 * second authorization path for a second consequential operation, the operation
 * becomes a step in the one path that already exists. There is no second
 * approval endpoint, no second grant target table, and no second place for the
 * approval semantics to drift.
 *
 * WHY THE RUN IS NOT STARTED UNDER THE REQUESTING AGENT. `startAgentRun` takes
 * an `agentId` and the executor then enforces that agent's `allowedCapabilities`
 * allowlist on top of the user's permissions. Volara agents are seeded with
 * read-level capabilities and NOT `volara.capital`, so a run started under the
 * requesting agent would be blocked by its own allowlist — correctly, but it
 * would report "capability not allowed" where the honest state is "waiting for a
 * person". The run is therefore the USER's, which is what it actually is: a
 * request put to the account holder, gated by the account holder's own
 * permissions.
 */

import { db } from "@/lib/db";
import { createAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { getPendingStepApproval } from "@/lib/policy/step-approvals";

export type SubmitRefusal = "NOT_FOUND" | "NOT_REQUESTED" | "EXPIRED" | "ALREADY_SUBMITTED";

export interface PendingAuthorization {
  allocationId: string;
  runId: string;
  stepId: string;
  /** What a human must assert back to approve. Recomputed server-side, always. */
  argumentsHash: string;
  classificationHash: string;
  policyDecision: string;
  capability: string;
  requiredLevel: string;
  requestedCents: number;
}

export type SubmitResult =
  | { submitted: true; pending: PendingAuthorization }
  | { submitted: false; reason: SubmitRefusal | "NO_PENDING_STEP" };

/**
 * Puts one requested allocation in front of a human.
 *
 * Idempotent on the allocation: a row that already carries a `runId` returns
 * that run's pending approval rather than creating a second one, so a retried
 * submission cannot produce two runs a human could approve twice for one
 * allocation. (Even if it did, the reservation's atomic guard and the
 * allocation's `status = 'REQUESTED'` condition would let only one through —
 * this is the cheaper first line of that defence, not the only one.)
 */
export async function submitAllocationForApproval(input: {
  userId: string;
  allocationId: string;
}): Promise<SubmitResult> {
  const allocation = await db.capitalAllocation.findFirst({
    where: { id: input.allocationId, userId: input.userId },
  });
  if (!allocation) return { submitted: false, reason: "NOT_FOUND" };
  if (allocation.status !== "REQUESTED") return { submitted: false, reason: "NOT_REQUESTED" };
  if (allocation.expiresAt.getTime() <= Date.now()) return { submitted: false, reason: "EXPIRED" };

  if (allocation.runId && allocation.stepId) {
    const existing = await getPendingStepApproval(input.userId, allocation.runId, allocation.stepId);
    if (existing.found) {
      return {
        submitted: true,
        pending: {
          allocationId: allocation.id,
          runId: allocation.runId,
          stepId: allocation.stepId,
          argumentsHash: existing.pending.argumentsHash,
          classificationHash: existing.pending.classificationHash,
          policyDecision: existing.pending.policyDecision,
          capability: existing.pending.capability,
          requiredLevel: existing.pending.requiredLevel,
          requestedCents: allocation.requestedCents,
        },
      };
    }
    // The run exists but its step is no longer awaiting approval — it was
    // approved, rejected or cancelled. Creating a second run for the same
    // allocation would be a second bite, so this refuses.
    return { submitted: false, reason: "ALREADY_SUBMITTED" };
  }

  const run = await createAgentRun({
    userId: input.userId,
    objective: `Approve capital allocation ${allocation.id}`,
    correlationId: allocation.correlationId,
    strategyId: allocation.strategyId ?? undefined,
    steps: [
      {
        description: `Reserve ${(allocation.requestedCents / 100).toFixed(2)} USD for allocation ${allocation.id}.`,
        toolName: "volara.allocate_capital",
        // ONLY the id. The amount, the agent and the strategy are read from the
        // persisted row — see the tool's docstring.
        input: { allocationId: allocation.id },
      },
    ],
  });

  // Executing parks at the gate: `volara.allocate_capital` is a HOLD and no
  // grant exists yet, so the step lands in WAITING_FOR_PERMISSION with its
  // arguments finalized and hashed. That is the point of running it now — the
  // hash a human is shown has to be the one the executor computed.
  await executeRun(input.userId, run.id);

  const step = await db.agentStep.findFirst({
    where: { runId: run.id, toolName: "volara.allocate_capital" },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  if (!step) return { submitted: false, reason: "NO_PENDING_STEP" };

  await db.capitalAllocation.updateMany({
    where: { id: allocation.id, userId: input.userId, status: "REQUESTED" },
    data: { runId: run.id, stepId: step.id },
  });

  const pending = await getPendingStepApproval(input.userId, run.id, step.id);
  if (!pending.found) {
    // The step is not awaiting approval, which for a HOLD action means the run
    // did not park where it should have. Refusing is the only safe reading:
    // reporting a pending approval that does not exist would invite a human to
    // approve nothing.
    return { submitted: false, reason: "NO_PENDING_STEP" };
  }

  return {
    submitted: true,
    pending: {
      allocationId: allocation.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
      classificationHash: pending.pending.classificationHash,
      policyDecision: pending.pending.policyDecision,
      capability: pending.pending.capability,
      requiredLevel: pending.pending.requiredLevel,
      requestedCents: allocation.requestedCents,
    },
  };
}
