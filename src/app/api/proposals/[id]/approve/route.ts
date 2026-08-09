import { approveProposal } from "@/lib/cognition/proposals";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/**
 * The only path to executing a Proposal's action. approveProposal() calls
 * the real enforceCapability() — a PermissionDeniedError here maps to 403
 * exactly like any other capability check in the app.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const proposal = await approveProposal(user.id, id);
    if (!proposal) throw new ApiError(404, "Proposal not found.");
    return jsonOk({ proposal });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
