/**
 * [P4-C2] HTTP shape for an approval refusal.
 *
 * Kept out of `src/lib/policy/step-approvals.ts` so the service stays free of
 * transport concerns, and shared by the approve and reject routes so the two
 * cannot answer the same refusal differently.
 *
 * The three "not found" reasons COLLAPSE to one public code on purpose.
 * Internally, `STEP_NOT_IN_RUN` means "that step id is real, but it lives in a
 * different run" — over HTTP that would be an existence oracle: an attacker
 * could enumerate step ids belonging to other people's runs by pairing them
 * with a run of their own and reading the reason back. The precise reason is
 * still recorded server-side; only the caller sees the coarse one.
 */

import type { StepApprovalRefusal } from "@/lib/policy/step-approvals";
import { jsonOk } from "@/lib/api/helpers";

type RefusalResponse = { status: number; reason: string; message: string };

const NOT_FOUND: RefusalResponse = {
  status: 404,
  reason: "NOT_FOUND",
  message: "No pending approval found for that step.",
};

const REFUSALS: Record<StepApprovalRefusal, RefusalResponse> = {
  RUN_NOT_FOUND: NOT_FOUND,
  STEP_NOT_FOUND: NOT_FOUND,
  STEP_NOT_IN_RUN: NOT_FOUND,
  STEP_NOT_AWAITING_APPROVAL: {
    status: 409,
    reason: "STEP_NOT_AWAITING_APPROVAL",
    message: "That step is not waiting for approval.",
  },
  STEP_HAS_NO_TOOL: {
    status: 409,
    reason: "NOT_APPROVABLE",
    message: "That step has no action to approve.",
  },
  UNKNOWN_ACTION: {
    status: 409,
    reason: "NOT_APPROVABLE",
    message: "That step's action is not in the classification registry.",
  },
  ARGUMENTS_NOT_FINALIZED: {
    status: 409,
    reason: "ARGUMENTS_NOT_FINALIZED",
    message: "That step's arguments are not finalized, so there is nothing definite to approve.",
  },
  ARGUMENTS_INVALID: {
    status: 409,
    reason: "ARGUMENTS_INVALID",
    message: "That step's stored arguments no longer validate against its action.",
  },
  // The action changed between being shown and being approved. 409 is the
  // honest code: the request was well formed, the state moved under it.
  HASH_MISMATCH: {
    status: 409,
    reason: "HASH_MISMATCH",
    message: "These arguments changed since they were shown. Review the action again before approving.",
  },
};

export function refusalResponse(refusal: StepApprovalRefusal): Response {
  const mapped = REFUSALS[refusal];
  return jsonOk({ error: mapped.message, reason: mapped.reason }, mapped.status);
}
