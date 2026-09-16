import { listExperimentEvidence, verifyEvidenceIntegrity } from "@/lib/economic/evidence";
import { getMeasuredProbability } from "@/lib/economic/probability";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-D] The evidence surface: every experiment's stage, the measured
 * probability, and any integrity findings.
 *
 * The probability is returned as the full `ProbabilityEvidence` shape rather
 * than a bare number, deliberately. `probability` is null whenever nothing has
 * been decided, and a caller that received only the number would have to invent
 * something to render in its place — which is how "no basis" becomes "0%".
 *
 * `integrity` is included on the same read rather than on a separate admin
 * route, because a probability shown beside a digest mismatch is a probability
 * standing on evidence that changed, and a person should not have to go looking
 * to find that out.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const [evidence, probability, integrity] = await Promise.all([
      listExperimentEvidence(user.id),
      getMeasuredProbability({ userId: user.id }),
      verifyEvidenceIntegrity(user.id),
    ]);
    return jsonOk({ evidence, probability, integrity });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
