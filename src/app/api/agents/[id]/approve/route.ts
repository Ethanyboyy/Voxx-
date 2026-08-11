import { resumeAgentRun } from "@/lib/agents/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** Re-attempts execution from the step it was waiting on. Never bypasses enforceCapability() — if the permission still isn't granted, the run stays WAITING_FOR_PERMISSION. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await resumeAgentRun(user.id, id);
    if (!run) throw new ApiError(404, "Agent run not found.");
    return jsonOk({ run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
