import { experimentDecisionState } from "@/lib/economic/experimentDecision";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-E] SCALE, HOLD OR KILL — asked on demand, answered deterministically.
 *
 * GET ONLY, and that is the design rather than an omission. `decide()` is pure,
 * so the answer is derivable from the contract and the ledger every time it is
 * asked; there is nothing to POST. Applying the decision stays with
 * `runEconomicTick()`, which is already the one writer of
 * `Experiment.lastDecision` — a second writer would make "when did VOX last
 * decide, and has the kill been applied" ambiguous on exactly the column an
 * operator reads to find out.
 *
 * The response carries `evidence`, which is the point of the endpoint. A
 * decision over a ledger nobody has accepted is sound arithmetic over an
 * unverified input, and a caller has to be able to tell that apart from a
 * decision a person stands behind.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const result = await experimentDecisionState(user.id, id);
    if (!result.available) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, result.detail);
      // 422: the request is well-formed and the experiment's state does not
      // support a deterministic decision. Not a 409 — nothing conflicts, the
      // contract simply cannot be evaluated.
      throw new ApiError(422, result.detail);
    }

    return jsonOk({
      decision: result.view.result.decision,
      bindingConstraint: result.view.result.bindingConstraint,
      reasons: result.view.result.reasons,
      evidence: result.view.evidence,
      humanVerdict: result.view.humanVerdict,
      actual: result.view.actual,
      contract: result.view.contract,
      actionPath: result.view.actionPath,
      // What the scheduler last wrote, so a caller can see whether a kill has
      // already been applied rather than inferring it.
      lastDecision: result.view.lastDecision,
      lastDecisionAt: result.view.lastDecisionAt,
      caveats: result.view.caveats,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
