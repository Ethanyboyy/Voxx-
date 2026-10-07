import { bindObservationSubject, interventionState } from "@/lib/commerce/intervention";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-F] THE INTERVENTION CHAIN FOR ONE EXPERIMENT.
 *
 * GET  the whole chain: the declared action, its execution identity, its
 *      external id, the window's subject, and whether the window may be
 *      observed yet — with the blocker named when it may not.
 * POST confirm that the subject exists externally, from the experiment's own
 *      SUCCEEDED intervention.
 *
 * WHAT IS NOT HERE, deliberately: declaring the action (`POST /api/commerce/actions`),
 * executing it (the `commerce.create_discount_code` tool through the executor,
 * behind `integration.shopify.write` at ACT and a policy HOLD that requires an
 * argument-bound `ApprovalGrant`), and asking the store whether it exists
 * (`POST /api/commerce/actions/[id]/observe`). All three already existed and
 * all three stay where they are. Adding a second door onto any of them is how
 * the gate gets skipped.
 *
 * The POST takes NO BODY. Everything it needs is already on the row: the
 * action's `externalId` and the contract's frozen subject. A body would be a
 * place for a caller to supply an external id of their own choosing, which is
 * exactly the thing this endpoint exists to avoid.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const state = await interventionState(user.id, id);
    if (!state) throw new ApiError(404, "Experiment not found.");

    return jsonOk({
      ...state,
      note: "Attribution over a declared window is not causation. Orders carrying a code are redemptions, not proof the code caused the purchase.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const result = await bindObservationSubject(user.id, id);
    if (!result.bound) {
      if (result.reason === "EXPERIMENT_NOT_FOUND") throw new ApiError(404, result.detail);
      // 409 throughout: every other refusal is a conflict with the state of the
      // intervention — not applied, already bound, or a subject that is not
      // this intervention's.
      throw new ApiError(409, result.detail);
    }

    return jsonOk({
      subject: result.subject,
      externalId: result.externalId,
      note: "The declared window will now attribute only to orders carrying this code. The window still has to be read completely for that subset to mean anything.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
