/**
 * [P4-C2] THE EXPLICIT "NO".
 *
 * Rejection exists so that "declined" and "not looked at yet" are different
 * states. It takes no body: refusing an action needs no assertion about the
 * action's contents, and accepting one would only invite a caller to describe
 * what it is rejecting.
 *
 * `rejectAgentStep()` creates no `ApprovalGrant`, and does not reach the grant
 * constructor at all — a rejection must never be able to authorize anything.
 */

import type { NextRequest } from "next/server";
import { rejectAgentStep } from "@/lib/policy/step-approvals";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { refusalResponse } from "../refusal";

type Context = { params: Promise<{ id: string; stepId: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { id, stepId } = await context.params;
    const result = await rejectAgentStep(user.id, id, stepId);
    if (!result.rejected) return refusalResponse(result.reason);
    return jsonOk({ rejected: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
