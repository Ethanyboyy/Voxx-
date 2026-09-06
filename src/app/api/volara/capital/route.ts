/**
 * [P4-F] Capital requests — list them, and put one to a human.
 *
 * `GET` returns the live requests with the supervisor's evidence-based ranking
 * beside them. THE RANKING IS ADVICE. A request at the top of it has exactly as
 * much authority as one at the bottom, which is none: both are `REQUESTED` rows
 * and both need the same approval.
 *
 * `POST { allocationId }` hands one request to the existing approval path and
 * returns the pending step to act on. It approves nothing. The response's
 * `runId` / `stepId` / `argumentsHash` are what a human then submits to
 * `POST /api/agents/[id]/steps/[stepId]/approve` — the SAME endpoint every
 * other held action uses. No second approval surface was built here, because a
 * second one is a second thing to get wrong.
 *
 * `202` rather than `200` on success, deliberately: the request has been
 * accepted for a decision, and nothing has been decided.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { submitAllocationForApproval } from "@/lib/volara/authorize";
import { getSupervisorView } from "@/lib/volara/supervisor";

const submitSchema = z.object({ allocationId: z.string().min(1).max(200) });

export async function GET() {
  try {
    const user = await requireUser();
    const view = await getSupervisorView(user.id);
    return jsonOk(view);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = submitSchema.parse(await request.json());
    const result = await submitAllocationForApproval({ userId: user.id, allocationId: body.allocationId });

    if (!result.submitted) {
      // 404 only for a row that is not this user's; everything else is a state
      // conflict, which is a different thing from "does not exist" and should
      // not be reported as one.
      throw new ApiError(result.reason === "NOT_FOUND" ? 404 : 409, refusalMessage(result.reason));
    }

    return jsonOk(
      {
        status: "WAITING_FOR_APPROVAL",
        ...result.pending,
        approveAt: `/api/agents/${result.pending.runId}/steps/${result.pending.stepId}/approve`,
      },
      202
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case "NOT_FOUND":
      return "That capital allocation was not found.";
    case "NOT_REQUESTED":
      return "That allocation has already been decided.";
    case "EXPIRED":
      return "That capital request has expired and must be made again.";
    case "ALREADY_SUBMITTED":
      return "That allocation has already been put to a human and is no longer awaiting approval.";
    default:
      return "The allocation could not be submitted for approval.";
  }
}
