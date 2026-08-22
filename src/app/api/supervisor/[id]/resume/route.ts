import { resumeSupervisorRun } from "@/lib/supervisor/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** The approval boundary's "Approve" action. Never bypasses the underlying capability check — resumes the exact same real permission-gated execution every other agent run goes through. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await resumeSupervisorRun(user.id, id);
    if (!run) throw new ApiError(404, "Supervisor run not found.");
    return jsonOk({ run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
