import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { getRunTrace } from "@/lib/capabilities/trace";

/**
 * Everything known about one orchestrated run.
 *
 * One id, not two: the run carries its own traceId now, so the workspace URL
 * only ever needs the run. Scoped to the caller inside the query, so another
 * user's run id returns 404 rather than their work.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const trace = await getRunTrace(user.id, { runId: id });
    if (!trace.runId) throw new ApiError(404, "Run not found.");
    return jsonOk({ trace });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
