import { readyExperiment } from "@/lib/economic/experiments";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * Arms a contract for the scheduler.
 *
 * A refusal here is a 400 carrying the exact unresolved terms — the caller
 * needs to know WHICH term is missing, since "not executable" alone is not
 * something a person or an agent can act on.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    try {
      return jsonOk({ experiment: await readyExperiment(user.id, id) });
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Contract could not be armed.");
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
