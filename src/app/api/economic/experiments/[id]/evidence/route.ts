import { getEvidenceLineage, getExperimentEvidence } from "@/lib/economic/evidence";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-D] The evidence state of one experiment, plus its full provenance chain.
 *
 * READ-ONLY, and the lineage is included by default rather than behind a flag.
 * The single most important thing a person can ask about a measurement is
 * "where did this number come from", and making them issue a second request for
 * the answer is how a surface ends up rendering the number without it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const evidence = await getExperimentEvidence(user.id, id);
    if (!evidence) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ evidence, lineage: await getEvidenceLineage(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
