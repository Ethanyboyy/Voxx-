import { predictExperimentOutcome } from "@/lib/economic/measurementLoop";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-D] FREEZE WHAT VOX EXPECTS, before anything is observed.
 *
 * Takes no body. That is the point: every term of the prediction is computed
 * from the opportunity's own per-figure model, so there is no field through
 * which a caller could supply a flattering number — and nothing to tune once
 * the result is in sight. The prediction is written once;
 * `ProfitPrediction.experimentId` is UNIQUE and a second POST is refused.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const result = await predictExperimentOutcome({ userId: user.id, experimentId: id });
    if (!result.predicted) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, result.detail);
      // 409 for the state conflicts, 422 for "the figures do not support it".
      throw new ApiError(result.reason === "ALREADY_PREDICTED" ? 409 : 422, result.detail);
    }

    return jsonOk({
      prediction: result.prediction,
      inputs: result.inputs,
      note: "Frozen. Improving a figure's provenance later does not rewrite this, and the outcome will be read from the ledger rather than from any estimate.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
