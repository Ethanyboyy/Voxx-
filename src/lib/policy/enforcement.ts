/**
 * P4-C3 — WHERE THE POLICY DECISION BECOMES A REFUSAL.
 *
 * Everything before this phase decided and recorded. `evaluatePolicy()` returned
 * `HOLD` for every `ACT`, every `FINANCIAL` action and every irreversible write,
 * and every one of them executed anyway. This module is the single place where
 * that stops being true.
 *
 * THREE THINGS THAT ARE NOT THE SAME THING, kept apart deliberately:
 *
 *   POLICY DECISION      what `evaluatePolicy()` says — ALLOW / HOLD / DENY.
 *   APPROVAL EVALUATION  whether a human's grant matches this exact execution.
 *   ENFORCEMENT          whether the execution actually proceeds.
 *
 * The third is this function's answer, and it is not a synonym for either of the
 * first two. A grant that *would* match is not permission — the caller still has
 * to be told, in a value it must branch on, that it may proceed. That is why
 * this returns a discriminated union and not a boolean, and why the shadow
 * recorder next door still returns `void`: it observes, this decides.
 *
 * WHY IT LIVES HERE AND NOT IN THE EXECUTOR. Two reasons. The executor must not
 * be able to reach the grant constructor (a grant it minted would be VOX
 * approving itself — see `step-approvals.ts`, the only module that may mint
 * one), and putting the decision procedure in one auditable function means a
 * security review reads one file rather than tracing branches through a
 * 400-line loop. This module spends grants; it cannot make them.
 *
 * FAIL-CLOSED. Shadow mode could afford to swallow its own errors — an observer
 * that breaks the thing it observes is worse than one that misses a record. An
 * *enforcer* that swallows an error has let the action through, so every failure
 * path in here returns a refusal instead. There is no exception that reaches the
 * caller and no branch that falls through to "permitted".
 */

import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import type { PolicyDecision } from "@/lib/policy/gate";
import {
  evaluateApprovalForExecution,
  consumeApprovalGrant,
  hashRegisteredClassification,
  type ApprovalMismatchReason,
  type ApprovalConsumptionFailure,
} from "@/lib/policy/approvals";
import type { ActionRegistry } from "@/lib/policy/classification";
import type { CapabilityLevel } from "@/generated/prisma/enums";

/**
 * Why an execution was refused.
 *
 * Mostly NOT new vocabulary: the approval mismatch reasons and the consumption
 * failures are reused verbatim from `@/lib/policy/approvals`, because inventing
 * a parallel set of codes for the same conditions is how two vocabularies drift
 * into disagreeing about the same event. Only the two conditions that approval
 * matching cannot express are added.
 */
export type EnforcementRefusal =
  | ApprovalMismatchReason
  | ApprovalConsumptionFailure
  /** The policy holds this action and the user holds no approval for it at all. */
  | "NO_GRANT"
  /** DENY. No approval exists that could authorize this, so none is solicited. */
  | "POLICY_DENIED"
  /** The action is not in the classification registry, so nothing could approve it. */
  | "UNCLASSIFIED_ACTION"
  /** The gate itself failed. Refusing is the only safe reading of "I don't know". */
  | "ENFORCEMENT_ERROR";

/**
 * What a caller does with a refusal.
 *
 *   AWAIT_APPROVAL — a human could fix this by approving the current action, so
 *                    the step parks and waits for one.
 *   REFUSE         — nothing a human can approve makes this runnable, so parking
 *                    would invite someone to authorize an action that can never
 *                    happen. Fail instead.
 */
export type EnforcementDisposition = "AWAIT_APPROVAL" | "REFUSE";

export type EnforcementOutcome =
  | {
      permitted: true;
      decision: PolicyDecision;
      /** The approval spent on this execution, when one was required. */
      grantId: string | null;
      classificationHash: string | null;
    }
  | {
      permitted: false;
      decision: PolicyDecision;
      disposition: EnforcementDisposition;
      /** Every reason, not just the first — an audit wants all of them. */
      reasons: EnforcementRefusal[];
      /** The nearest-miss grant, when one was considered. */
      grantId: string | null;
      classificationHash: string | null;
    };

export interface EnforceExecutionInput {
  userId: string;
  registry: ActionRegistry;
  /** Looked up in the frozen registry. Never parsed for meaning. */
  actionId: string;
  /** Recomputed by the caller from the persisted, finalized arguments. */
  argumentsHash: string;
  capability: string;
  requiredLevel: CapabilityLevel;
  /** The execution target a grant must name exactly. */
  targetType: string;
  targetId: string;
  /** Descriptive only, for the audit record. */
  runId?: string;
  stepId?: string;
  subjectType?: string;
  subjectId?: string;
}

/**
 * Decides whether one execution may proceed, and spends the approval if it may.
 *
 * The order is the whole security argument, so it is worth stating plainly:
 *
 *   1. Look the action up in the FROZEN registry. Not the caller's description
 *      of it — a caller that could describe an action as milder than it is would
 *      be the only vulnerability that mattered.
 *   2. Take the decision from that classification's own snapshot. This is the
 *      same snapshot a grant binds its `classificationHash` to, which is what
 *      makes requirement 5 automatic: amend the matrix and every outstanding
 *      approval taken under the old one stops matching, with no migration.
 *   3. ALLOW proceeds with no approval. P4-C3 is not "everything needs a human".
 *   4. DENY refuses outright and solicits nothing.
 *   5. HOLD requires a live grant that matches on user, registry, action,
 *      arguments, classification, capability, required level, amplification,
 *      target and expiry — `matchesApproval` checks all of them.
 *   6. ONLY THEN consume, via the existing compare-and-swap.
 *   7. A consumption that loses the race refuses. It does not fall through.
 */
export async function enforceStepExecution(input: EnforceExecutionInput): Promise<EnforcementOutcome> {
  try {
    const classified = hashRegisteredClassification(input.registry, input.actionId);
    if (!classified) {
      // An unregistered action cannot be classified, and `approveAgentStep()`
      // refuses to approve one for the same reason. Refusing here makes a
      // forgotten classification a loud failure rather than a silent bypass —
      // the failure mode that matters, since a new tool with no table entry
      // would otherwise be the one thing the gate never sees.
      return {
        permitted: false,
        decision: "DENY",
        disposition: "REFUSE",
        reasons: ["UNCLASSIFIED_ACTION"],
        grantId: null,
        classificationHash: null,
      };
    }

    const decision = classified.snapshot.decision;
    const classificationHash = classified.hash;

    if (decision === "ALLOW") {
      return { permitted: true, decision, grantId: null, classificationHash };
    }

    if (decision === "DENY") {
      // "There is no legitimate authorization path" — see the P4-A note in
      // gate.ts. Parking a DENY would ask a person to approve something no
      // approval can make acceptable.
      return {
        permitted: false,
        decision,
        disposition: "REFUSE",
        reasons: ["POLICY_DENIED"],
        grantId: null,
        classificationHash,
      };
    }

    // HOLD. The only path from here to execution runs through a human's grant.
    const match = await evaluateApprovalForExecution({
      userId: input.userId,
      registry: input.registry,
      actionId: input.actionId,
      argumentsHash: input.argumentsHash,
      classificationHash,
      capability: input.capability,
      requiredLevel: input.requiredLevel,
      targetType: input.targetType,
      targetId: input.targetId,
      runId: input.runId,
      stepId: input.stepId,
    });

    if (!match.wouldAuthorize || !match.grantId) {
      // Preserved from P4-C1/C2: the record of whether an approval WOULD have
      // matched, which is a different question from what enforcement then did.
      await recordApprovalEvaluation(input, decision, classificationHash, match, false);
      return {
        permitted: false,
        decision,
        disposition: "AWAIT_APPROVAL",
        reasons: match.reasons,
        grantId: null,
        classificationHash,
      };
    }

    // Every check has passed. Spend the approval — and only now, because a grant
    // spent before validation would be burned by an execution that was never
    // going to be allowed.
    const consumption = await consumeApprovalGrant(input.userId, match.grantId);
    await recordApprovalEvaluation(input, decision, classificationHash, match, consumption.consumed);
    if (!consumption.consumed) {
      // Another execution won the compare-and-swap, or the grant expired between
      // the match and the spend. Either way this execution holds nothing, and a
      // near-miss must never fall through into the permitted branch.
      return {
        permitted: false,
        decision,
        disposition: "AWAIT_APPROVAL",
        reasons: [consumption.reason],
        grantId: match.grantId,
        classificationHash,
      };
    }

    return { permitted: true, decision, grantId: match.grantId, classificationHash };
  } catch (error) {
    // The one place where this module differs from its shadow-mode predecessor:
    // an error is a refusal, not a shrug. "I could not determine whether this is
    // allowed" and "this is allowed" are not the same answer.
    logger.error("policy.enforcement_failed", {
      actionId: input?.actionId,
      runId: input?.runId,
      stepId: input?.stepId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      permitted: false,
      decision: "DENY",
      disposition: "REFUSE",
      reasons: ["ENFORCEMENT_ERROR"],
      grantId: null,
      classificationHash: null,
    };
  }
}

/**
 * The approval-evaluation record, kept from P4-C1/C2.
 *
 * It answers "would a grant have matched", which stays worth recording now that
 * enforcement acts on the answer — it is how an operator sees *why* an approval
 * did not apply. What changed is the honesty of two fields: `enforced` is now
 * true, and `executionContinued` reports the actual consequence rather than
 * asserting that nothing was stopped.
 *
 * Never throws: a failed audit write must not turn into an accidental permit.
 */
async function recordApprovalEvaluation(
  input: EnforceExecutionInput,
  policyDecision: PolicyDecision,
  classificationHash: string,
  match: Awaited<ReturnType<typeof evaluateApprovalForExecution>>,
  grantConsumed: boolean
): Promise<void> {
  try {
    await recordEvent({
      userId: input.userId,
      type: "policy.approval_shadow_evaluated",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      consequential: false,
      payload: {
        stepId: input.stepId ?? null,
        actionId: input.actionId,
        registry: input.registry,
        policyDecision,
        argumentsHash: input.argumentsHash,
        classificationHash,
        wouldAuthorize: match.wouldAuthorize,
        grantId: match.grantId,
        candidatesConsidered: match.candidatesConsidered,
        reasons: match.reasons,
        // Whether the matched approval was actually spent on this execution. A
        // match that could not be spent — another execution won the race, or it
        // expired in between — is the single-use rule working, not an error.
        grantConsumed,
        // [P4-C3] All three of these were hardcoded to the shadow-mode answer
        // before. `executionContinued` is now the real consequence: an approval
        // that matched but could not be spent does NOT let the step run.
        enforced: true,
        executionContinued: grantConsumed,
      },
    });
  } catch (error) {
    logger.error("policy.approval_evaluation_record_failed", {
      actionId: input.actionId,
      stepId: input.stepId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The refusal record. Distinct from `policy.approval_consumed` on purpose: this
 * says an execution did NOT happen, that one says an approval was spent.
 *
 * Never throws, for the same reason as above — the refusal has already been
 * decided, and losing its audit line must not undo it.
 */
export async function recordExecutionRefusal(input: {
  userId: string;
  actionId: string;
  registry: ActionRegistry;
  decision: PolicyDecision;
  disposition: EnforcementDisposition;
  reasons: EnforcementRefusal[];
  grantId: string | null;
  classificationHash: string | null;
  argumentsHash: string;
  runId?: string;
  stepId?: string;
  subjectType?: string;
  subjectId?: string;
}): Promise<void> {
  try {
    await recordEvent({
      userId: input.userId,
      type: "policy.execution_refused",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      // Refusing to act IS a consequential outcome: it is the gate changing what
      // VOX did, which is exactly what the consequential feed exists to show.
      consequential: true,
      payload: {
        stepId: input.stepId ?? null,
        runId: input.runId ?? null,
        actionId: input.actionId,
        registry: input.registry,
        decision: input.decision,
        disposition: input.disposition,
        reasons: input.reasons,
        grantId: input.grantId,
        classificationHash: input.classificationHash,
        argumentsHash: input.argumentsHash,
        enforced: true,
        executionContinued: false,
      },
    });
  } catch (error) {
    logger.error("policy.execution_refusal_record_failed", {
      actionId: input.actionId,
      stepId: input.stepId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
