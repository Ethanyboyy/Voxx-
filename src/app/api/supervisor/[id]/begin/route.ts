import { beginSupervisorExecution } from "@/lib/supervisor/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** MANUAL autonomy's "Start execution" action — runs exactly the plan the
 * Supervisor already produced and stopped at BLOCKED for. Never re-plans. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await beginSupervisorExecution(user.id, id);
    if (!run) throw new ApiError(404, "Supervisor run not found.");
    return jsonOk({ run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
