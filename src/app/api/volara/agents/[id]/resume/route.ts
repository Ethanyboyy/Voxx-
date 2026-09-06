/**
 * [P4-F] A human lifts a suspension.
 *
 * The ONLY path out of SUSPENDED. `resumeAgent()` is the sole caller allowed to
 * pass `humanResume` to `transitionAgent()`, and nothing under
 * `src/lib/volara/` reaches this route — an agent that could resume itself
 * would make suspension advisory rather than a stop.
 *
 * `consecutiveFailures` is reset; `failureCount` is not. Lifetime failure
 * history survives a resume, because erasing it to make an agent look healthy
 * is the audit deletion §22 forbids.
 */

import type { NextRequest } from "next/server";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { resumeAgent } from "@/lib/volara/state";
import { newCorrelationId } from "@/lib/volara/governor";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const result = await resumeAgent(user.id, id, newCorrelationId());
    if (!result.transitioned) {
      throw new ApiError(result.reason === "AGENT_NOT_FOUND" ? 404 : 409, resumeMessage(result.reason));
    }
    return jsonOk({ resumed: true, from: result.from, to: result.to });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function resumeMessage(reason: string): string {
  switch (reason) {
    case "AGENT_NOT_FOUND":
      return "That agent was not found.";
    case "ILLEGAL_TRANSITION":
      return "That agent is not in a state a resume can lift.";
    case "STATE_MOVED":
      return "That agent's state changed while the resume was being applied. Try again.";
    default:
      return "The agent could not be resumed.";
  }
}
