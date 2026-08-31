import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { cancelRun } from "@/lib/capabilities/orchestrator";
import { getRunTrace } from "@/lib/capabilities/trace";

/**
 * Stops a run without destroying what it already produced.
 *
 * Unreached steps become SKIPPED and the run CANCELLED; nothing is deleted.
 * Every artifact, version and lineage row written before this point survives,
 * because the expensive half of a cancelled run is usually the half that
 * already succeeded.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const cancelled = await cancelRun(user.id, id);
    if (!cancelled) throw new ApiError(404, "Run not found.");
    return jsonOk({ trace: await getRunTrace(user.id, { runId: id }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
