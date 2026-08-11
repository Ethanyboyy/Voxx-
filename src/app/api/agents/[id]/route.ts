import { getAgentRun } from "@/lib/agents/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await getAgentRun(user.id, id);
    if (!run) throw new ApiError(404, "Agent run not found.");
    return jsonOk({ run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
