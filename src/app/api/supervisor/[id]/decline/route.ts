import { declineSupervisorRun } from "@/lib/supervisor/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** The approval boundary's "Decline" action — cancels the blocked agent run and stops the objective's autonomous work. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await declineSupervisorRun(user.id, id);
    if (!run) throw new ApiError(404, "Supervisor run not found.");
    return jsonOk({ run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
