import { z } from "zod";
import { HUMAN_VERDICTS, reconcileExperimentOutcome } from "@/lib/economic/probability";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-C/P5-D] A HUMAN records the verdict.
 *
 * The one path by which an experiment outcome becomes WIN or LOSS, and therefore
 * the one path by which anything enters the measured probability. VOX does not
 * post to this endpoint — no tool, no proposal handler, no agent step reaches
 * `reconcileExperimentOutcome()`. A person does, and the Event it writes records
 * that a person did.
 */
const bodySchema = z.object({
  verdict: z.enum(HUMAN_VERDICTS),
  note: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());

    const result = await reconcileExperimentOutcome({
      userId: user.id,
      experimentId: id,
      verdict: body.verdict,
      note: body.note,
    });

    if (!result.reconciled) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, "Experiment not found.");
      throw new ApiError(409, refusalMessage(result.reason));
    }

    return jsonOk({ outcome: result.outcome, basis: result.basis, measurementId: result.measurementId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case "ALREADY_RECONCILED":
      return "A verdict is already recorded for this experiment.";
    case "INVALID_VERDICT":
      return "A verdict must be WIN, LOSS or INCONCLUSIVE.";
    case "MEASUREMENT_MISSING":
      return "VOX executed this experiment and no measurement came out of it. Recording a verdict now would rest a success or a failure on an execution nobody observed. Observe the execution first, or record the figure by hand and say that is what you did.";
    default:
      return "The verdict could not be recorded.";
  }
}
