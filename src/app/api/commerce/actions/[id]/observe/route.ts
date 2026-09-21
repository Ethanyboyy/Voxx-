import { getCommercialAction, observeCommercialAction } from "@/lib/commerce/execute";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const action = await getCommercialAction(user.id, id);
    if (!action) throw new ApiError(404, "Commercial action not found.");
    return jsonOk({ action });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * [P5-G] Asks the store what actually happened.
 *
 * THE ONLY WAY OUT OF AN UNKNOWN OUTCOME. A read, so it is not ACT-gated — the
 * safe response to an ambiguous write must not be harder to reach than the
 * write was, or the remaining move becomes a retry.
 *
 * A failed check is returned as a successful HTTP response carrying
 * `observed: false`, because "the store could not be asked" is a real answer and
 * an error status would invite a client to render it as "the discount is absent".
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const result = await observeCommercialAction(user.id, id);

    if (!result.observed) {
      if (result.failure === "NOT_FOUND") throw new ApiError(404, "Commercial action not found.");
      return jsonOk({
        observed: false,
        failure: result.failure,
        detail: result.detail,
        note: "The store could not be asked. This does NOT mean the discount is absent.",
      });
    }

    return jsonOk({
      observed: true,
      exists: result.exists,
      matches: result.matches,
      // A count of uses. Never money, never revenue.
      redemptions: result.redemptions,
      status: result.status,
      resolved: result.resolved,
      detail: result.detail,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
