import { liveReadiness } from "@/lib/commerce/liveReadiness";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-G] WHAT STANDS BETWEEN VOX AND ITS FIRST REAL COMMERCIAL ACTION.
 *
 * GET only, and it makes no external call. A readiness check that phoned
 * Shopify to prove the token still works would itself be the live request it is
 * meant to be checking the preconditions for.
 *
 * It returns the shop domain, which is public, and nothing else about the
 * credential — no token, no prefix, no length, no hash.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ readiness: await liveReadiness(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
