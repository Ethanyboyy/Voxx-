import { dispatchIntervention } from "@/lib/commerce/dispatch";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-G] PUTS A DECLARED INTERVENTION IN FRONT OF THE EXISTING GATES.
 *
 * TAKES NO BODY. The `actionId` is the path and the `contractDigest` is read
 * off the frozen row — there is nowhere for a caller to name an action's
 * arguments, which is the whole reason this exists rather than an operator
 * composing an agent-run objective and hoping a planner gets the digest right.
 *
 * A 200 WITH `runStatus: "WAITING_FOR_PERMISSION"` AND
 * `actionStatus: "PLANNED"` IS THE NORMAL FIRST RESPONSE, and it means nothing
 * was sent. The step is a policy HOLD at `integration.shopify.write` / ACT, so
 * it stops and waits for a person at
 * `POST /api/agents/[runId]/steps/[stepId]/approve` — the one surface in VOX
 * where a decision becomes an `ApprovalGrant`. Approving there resumes the run.
 *
 * This route mints no grant, grants no capability, and performs no external
 * call of its own.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const result = await dispatchIntervention(user.id, id);
    if (!result.dispatched) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, result.detail);
      // 409 for the rest: each one is a statement about the action's state, not
      // about a malformed request.
      throw new ApiError(409, result.detail);
    }

    return jsonOk({
      ...result,
      note:
        result.actionStatus === "PLANNED"
          ? "Nothing has been sent. The step is waiting for a human approval bound to these exact arguments."
          : result.actionStatus === "UNKNOWN"
            ? "The request was submitted and its outcome is NOT known. It will not be retried. Ask the store whether the code exists."
            : result.actionStatus === "SUCCEEDED"
              ? "A discount code now exists in the store. No money moved and no revenue was created."
              : `The action is ${result.actionStatus}.`,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
