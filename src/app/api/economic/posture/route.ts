import { nextBestEconomicAction } from "@/lib/economic/nextAction";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-A] "What is the best thing VOX can do right now to increase expected net
 * profit?"
 *
 * READ-ONLY. It computes a recommendation and returns it; it allocates nothing,
 * approves nothing and executes nothing. Every action it can name is performed
 * through that action's own existing gated path, which keeps its own gate.
 *
 * The whole plan is returned alongside the recommendation — the selected, the
 * deferred with their binding reasons, and the unrankable with the dimensions
 * to go and establish — so the answer is inspectable rather than asserted. A
 * surface that showed only the top recommendation would be a surface that
 * cannot be argued with.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ posture: await nextBestEconomicAction(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
