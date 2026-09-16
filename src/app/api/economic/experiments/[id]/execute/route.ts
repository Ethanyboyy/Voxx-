import { requestExperimentExecution } from "@/lib/economic/evidence";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-D] Dispatches an experiment's declared observation through the existing
 * executor.
 *
 * NOT an execution endpoint in its own right. It claims the experiment's
 * one-and-only execution identity and hands the work to `executeRun()`, which
 * performs the capability check and the policy enforcement exactly as it does
 * for every other run in VOX. This route mints no grant and bypasses nothing —
 * a run that parks at WAITING_FOR_PERMISSION comes back as a successful
 * dispatch in a waiting stage, because that IS the correct outcome.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const result = await requestExperimentExecution(user.id, id);

    if (!result.dispatched) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, "Experiment not found.");
      // 409 rather than 400 across the board: every remaining refusal is a
      // statement about the experiment's current state (already dispatched,
      // already judged, race lost), not about a malformed request.
      throw new ApiError(409, refusalMessage(result.reason));
    }

    return jsonOk({ dispatched: true, runId: result.runId, stage: result.stage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case "ALREADY_DISPATCHED":
      return "This experiment already has an execution. An experiment is executed once, so that 'the execution' it was measured from is never ambiguous.";
    case "DISPATCH_RACE_LOST":
      return "Another dispatch claimed this experiment's execution first. Nothing was executed twice.";
    case "ALREADY_RECONCILED":
      return "A verdict has already been recorded for this experiment. Re-running it now would be choosing evidence after the fact.";
    case "NO_OBSERVATION_RULE":
      return "This experiment declares no observation rule. What will be counted has to be chosen before the experiment runs, not after.";
    case "UNKNOWN_OBSERVATION_RULE":
      return "This experiment's observation rule is not in the frozen registry.";
    default:
      return "The experiment could not be dispatched.";
  }
}
