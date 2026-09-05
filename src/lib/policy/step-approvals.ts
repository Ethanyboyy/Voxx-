/**
 * P4-C2 — THE HUMAN APPROVAL ACT.
 *
 * This module is the ONLY place in VOX that turns a person's decision into an
 * `ApprovalGrant`. Everything about its shape follows from one invariant:
 *
 *   A grant exists IF AND ONLY IF an authorized human explicitly approved the
 *   exact finalized arguments of a specific pending step.
 *
 * WHY IT COULD NOT BE FOLDED INTO RESUME. The P4-C audit stopped short of
 * enforcement because the obvious design — executor reaches HOLD, executor
 * creates the grant, resume consumes it — has the executor approving its own
 * work. Every hash would match, because both sides came from the same place,
 * and the binding would authorize nothing a person ever saw. Resume is likewise
 * not approval: `POST /api/capabilities/runs/[id]/resume` says so in its own
 * docstring, and `resumeAgentRun()` is four lines that re-enter the executor.
 * Neither carries an assertion about WHICH action a human looked at.
 *
 * SO THE CLIENT ASSERTS A HASH, AND ONLY A HASH. `approveAgentStep()` accepts
 * `runId`, `stepId` and `argumentsHash` — nothing else. It takes no tool name,
 * no capability, no arguments, no classification, no decision. Every one of
 * those is read from the persisted step and the frozen registry, because a
 * client that could name its own capability could approve one thing and
 * authorize another.
 *
 * The submitted hash is a CLAIM ("I approve the arguments this hash stands
 * for"), never evidence of what the arguments are. The server recomputes the
 * canonical hash from `AgentStep.input` — the representation P4-C1 finalized
 * and persisted before the pause — and refuses if the two disagree. That is
 * what makes "the human saw A, the action became B" impossible.
 *
 * APPROVING IS NOT GRANTING. A grant records consent to a specific invocation;
 * it does not confer the capability, and `checkCapability()` remains the only
 * thing that answers whether the capability is held. A step can be approved and
 * still park for permission, which is correct: they are two different questions,
 * asked of the same person at different moments.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { hasStepReference } from "@/lib/agents/references";
import { getTool } from "@/lib/tools/registry";
import { cancelAgentRun } from "@/lib/agents/service";
import {
  hashArguments,
  hashRegisteredClassification,
  createApprovalGrant,
  STEP_APPROVAL_TARGET_TYPE,
} from "@/lib/policy/approvals";
import type { ApprovalGrant } from "@/generated/prisma/client";
import type { CapabilityLevel } from "@/generated/prisma/enums";

/**
 * Ties a grant to one agent step. Defined in `@/lib/policy/approvals` so the
 * executor can read it without importing this module (which reaches into the
 * agent service, and so back into the executor); re-exported here because this
 * is where it is meaningful.
 */
export { STEP_APPROVAL_TARGET_TYPE };

/** Why an approval was refused. Codes, so no caller parses prose. */
export type StepApprovalRefusal =
  | "RUN_NOT_FOUND"
  | "STEP_NOT_FOUND"
  | "STEP_NOT_IN_RUN"
  | "STEP_NOT_AWAITING_APPROVAL"
  | "STEP_HAS_NO_TOOL"
  | "UNKNOWN_ACTION"
  | "ARGUMENTS_NOT_FINALIZED"
  | "ARGUMENTS_INVALID"
  | "HASH_MISMATCH";

/**
 * Everything a person needs in order to approve — all of it read from the
 * server's own canonical state.
 *
 * `finalizedArguments` is what P4-C1 persisted, NOT the authored template. A
 * surface that showed `{{step0.output}}` would be asking someone to consent to
 * a placeholder.
 */
export interface PendingStepApproval {
  runId: string;
  stepId: string;
  actionId: string;
  description: string;
  finalizedArguments: unknown;
  argumentsHash: string;
  classificationHash: string;
  policyDecision: string;
  capability: string;
  requiredLevel: CapabilityLevel;
  /** True when a live grant for this exact step and hash already exists. */
  alreadyApproved: boolean;
}

type Resolved = {
  step: { id: string; runId: string; description: string; toolName: string | null; input: string | null };
  actionId: string;
  canonicalArguments: unknown;
  argumentsHash: string;
  classificationHash: string;
  policyDecision: string;
  capability: string;
  requiredLevel: CapabilityLevel;
};

/**
 * Loads the step and derives its canonical facts, or refuses.
 *
 * Shared by the read and the write path deliberately: the details a person is
 * shown and the details the approval is checked against must come from one
 * computation, or the surface and the check can disagree.
 */
async function resolvePendingStep(
  userId: string,
  runId: string,
  stepId: string
): Promise<{ ok: true; value: Resolved } | { ok: false; reason: StepApprovalRefusal }> {
  // Scoped by userId at the query: another account's run is simply not found.
  const run = await db.agentRun.findFirst({ where: { id: runId, userId }, select: { id: true } });
  if (!run) return { ok: false, reason: "RUN_NOT_FOUND" };

  const step = await db.agentStep.findUnique({
    where: { id: stepId },
    select: { id: true, runId: true, description: true, toolName: true, input: true, status: true },
  });
  if (!step) return { ok: false, reason: "STEP_NOT_FOUND" };
  // The step must belong to the run that was named. Without this, a caller who
  // knows any step id could approve it by pairing it with a run they own.
  if (step.runId !== run.id) return { ok: false, reason: "STEP_NOT_IN_RUN" };
  if (step.status !== "WAITING_FOR_PERMISSION") return { ok: false, reason: "STEP_NOT_AWAITING_APPROVAL" };
  if (!step.toolName) return { ok: false, reason: "STEP_HAS_NO_TOOL" };

  // The ACTION comes from the persisted step, never from the caller.
  const tool = getTool(step.toolName);
  if (!tool) return { ok: false, reason: "UNKNOWN_ACTION" };
  const classified = hashRegisteredClassification("tool", step.toolName);
  if (!classified) return { ok: false, reason: "UNKNOWN_ACTION" };

  let parsed: unknown;
  try {
    parsed = step.input ? JSON.parse(step.input) : {};
  } catch {
    return { ok: false, reason: "ARGUMENTS_INVALID" };
  }

  // P4-C1 finalizes before parking, so a template here means something is wrong
  // upstream. Refusing is the only safe answer: hashing a placeholder would bind
  // an approval to text rather than to the call that will run.
  if (hasStepReference(parsed)) return { ok: false, reason: "ARGUMENTS_NOT_FINALIZED" };

  // Re-validated through the tool's own schema so the hash covers exactly what
  // `tool.execute()` would receive — the same representation the executor hashes.
  const validated = tool.inputSchema.safeParse(parsed);
  if (!validated.success) return { ok: false, reason: "ARGUMENTS_INVALID" };

  return {
    ok: true,
    value: {
      step,
      actionId: step.toolName,
      canonicalArguments: validated.data,
      argumentsHash: hashArguments(validated.data),
      classificationHash: classified.hash,
      policyDecision: classified.snapshot.decision,
      capability: tool.capability,
      requiredLevel: tool.requiredLevel,
    },
  };
}

/** An existing live grant for this exact step and hash, if there is one. */
async function findLiveGrant(userId: string, resolved: Resolved, now: Date): Promise<ApprovalGrant | null> {
  return db.approvalGrant.findFirst({
    where: {
      userId,
      registry: "tool",
      actionId: resolved.actionId,
      argumentsHash: resolved.argumentsHash,
      classificationHash: resolved.classificationHash,
      targetType: STEP_APPROVAL_TARGET_TYPE,
      targetId: resolved.step.id,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "asc" },
  });
}

export type PendingStepApprovalResult =
  | { found: true; pending: PendingStepApproval }
  | { found: false; reason: StepApprovalRefusal };

/**
 * What is waiting, for a surface to render. A pure read.
 *
 * Creates nothing. Looking at a pending action is not approving it, and a GET
 * that minted a grant would make merely opening a page an authorization.
 */
export async function getPendingStepApproval(
  userId: string,
  runId: string,
  stepId: string,
  now: Date = new Date()
): Promise<PendingStepApprovalResult> {
  const resolved = await resolvePendingStep(userId, runId, stepId);
  if (!resolved.ok) return { found: false, reason: resolved.reason };

  const existing = await findLiveGrant(userId, resolved.value, now);
  return {
    found: true,
    pending: {
      runId,
      stepId: resolved.value.step.id,
      actionId: resolved.value.actionId,
      description: resolved.value.step.description,
      finalizedArguments: resolved.value.canonicalArguments,
      argumentsHash: resolved.value.argumentsHash,
      classificationHash: resolved.value.classificationHash,
      policyDecision: resolved.value.policyDecision,
      capability: resolved.value.capability,
      requiredLevel: resolved.value.requiredLevel,
      alreadyApproved: existing !== null,
    },
  };
}

export interface ApproveAgentStepInput {
  userId: string;
  runId: string;
  stepId: string;
  /**
   * The hash the human was shown. An ASSERTION about which arguments they
   * consented to — never a source of what those arguments are.
   */
  argumentsHash: string;
  now?: Date;
}

export type ApproveAgentStepResult =
  | { approved: true; grant: ApprovalGrant; reused: boolean }
  | { approved: false; reason: StepApprovalRefusal };

/**
 * The human approval act. The only caller of `createApprovalGrant()` in VOX.
 *
 * Order matters: every check runs against server state before anything is
 * written, and the grant is assembled entirely from the persisted step and the
 * frozen registry. The caller contributes exactly one thing — the hash — and
 * that is compared, not trusted.
 */
export async function approveAgentStep(input: ApproveAgentStepInput): Promise<ApproveAgentStepResult> {
  const now = input.now ?? new Date();
  const resolved = await resolvePendingStep(input.userId, input.runId, input.stepId);
  if (!resolved.ok) return { approved: false, reason: resolved.reason };

  // THE BINDING CHECK. The person saw some arguments and is asserting a hash
  // for them; the server recomputed the hash of what is actually persisted. If
  // the action changed in between, these differ and the approval is refused —
  // which is what makes "saw A, executes B" impossible.
  if (resolved.value.argumentsHash !== input.argumentsHash) {
    await recordEvent({
      userId: input.userId,
      type: "policy.approval_rejected",
      subjectType: "AgentRun",
      subjectId: input.runId,
      consequential: true,
      payload: {
        stepId: resolved.value.step.id,
        actionId: resolved.value.actionId,
        reason: "HASH_MISMATCH",
        submittedArgumentsHash: input.argumentsHash,
        canonicalArgumentsHash: resolved.value.argumentsHash,
      },
    });
    return { approved: false, reason: "HASH_MISMATCH" };
  }

  // Approving twice is one approval, not two grants. Returning the live one
  // keeps a double-click, a retry or a duplicated request from stockpiling
  // authorizations for the same act.
  const existing = await findLiveGrant(input.userId, resolved.value, now);
  if (existing) return { approved: true, grant: existing, reused: true };

  const grant = await createApprovalGrant({
    userId: input.userId,
    registry: "tool",
    // All of this is server-derived. None of it can be influenced by the caller.
    actionId: resolved.value.actionId,
    parsedArguments: resolved.value.canonicalArguments,
    policyDecision: resolved.value.policyDecision as never,
    capability: resolved.value.capability,
    requiredLevel: resolved.value.requiredLevel,
    targetType: STEP_APPROVAL_TARGET_TYPE,
    targetId: resolved.value.step.id,
    now,
  });

  await recordEvent({
    userId: input.userId,
    type: "policy.approval_approved",
    subjectType: "AgentRun",
    subjectId: input.runId,
    consequential: true,
    // The audit record of a HUMAN act — distinct from `approval_granted` (the
    // grant row), `approval_consumed` (its use), and resume (not an approval).
    payload: {
      stepId: resolved.value.step.id,
      grantId: grant.id,
      actionId: resolved.value.actionId,
      argumentsHash: resolved.value.argumentsHash,
      classificationHash: resolved.value.classificationHash,
      policyDecision: resolved.value.policyDecision,
      capability: resolved.value.capability,
      requiredLevel: resolved.value.requiredLevel,
    },
  });

  return { approved: true, grant, reused: false };
}

export type RejectAgentStepResult = { rejected: true } | { rejected: false; reason: StepApprovalRefusal };

/**
 * The explicit "no".
 *
 * Records the refusal and cancels the run through the EXISTING
 * `cancelAgentRun()`, which preserves completed work. Creates no grant, and
 * cannot: this function does not call `createApprovalGrant()` at all.
 *
 * It exists so the surface has an unambiguous second option. Without it, "not
 * approved" and "not yet looked at" would be the same state.
 */
export async function rejectAgentStep(
  userId: string,
  runId: string,
  stepId: string
): Promise<RejectAgentStepResult> {
  const resolved = await resolvePendingStep(userId, runId, stepId);
  if (!resolved.ok) return { rejected: false, reason: resolved.reason };

  await recordEvent({
    userId,
    type: "policy.approval_rejected",
    subjectType: "AgentRun",
    subjectId: runId,
    consequential: true,
    payload: {
      stepId: resolved.value.step.id,
      actionId: resolved.value.actionId,
      argumentsHash: resolved.value.argumentsHash,
      reason: "DECLINED_BY_HUMAN",
    },
  });

  await cancelAgentRun(userId, runId);
  return { rejected: true };
}
