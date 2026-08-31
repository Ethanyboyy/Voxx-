import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { resumeRun } from "@/lib/capabilities/orchestrator";
import { getRunTrace } from "@/lib/capabilities/trace";

/**
 * Continues a run that stopped for a permission.
 *
 * This is not an approval endpoint and does not grant anything. The user
 * grants the capability through the existing Permissions surface; this just
 * asks the executor to try again, and the executor re-runs the real
 * `checkCapability()`. If the permission is still not granted the run simply
 * parks again — which is why there is no way to force it from here.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const resumed = await resumeRun(user.id, id);
    if (!resumed) throw new ApiError(404, "Run not found.");
    return jsonOk({ trace: await getRunTrace(user.id, { runId: id }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
