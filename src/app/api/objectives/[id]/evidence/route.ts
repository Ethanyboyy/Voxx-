import { getObjectiveEvidence } from "@/lib/objectives/evidence";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/**
 * The evidence VOX holds because this objective is being pursued — the same
 * graph edges a planning pass reads, exposed for the objective's own page.
 *
 * Read-only by design: evidence is written by the work that produced it
 * (research, experiments, simulations), never by a client asserting it.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    // Scoped to the caller inside the service — an objective that isn't
    // theirs returns an empty dossier rather than another user's evidence.
    const evidence = await getObjectiveEvidence(user.id, id);
    return jsonOk({ evidence });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
