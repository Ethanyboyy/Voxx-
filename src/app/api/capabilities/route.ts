import type { NextRequest } from "next/server";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { getProviderStatuses } from "@/lib/capabilities/availability";
import { getUsageSummary } from "@/lib/capabilities/ledger";

/**
 * What VOX can do right now, and what it has spent doing it.
 *
 * Provider *status* only — never a key, and never anything derived from one.
 * `unavailableReason` is written to name the missing env var so the answer is
 * actionable, which is the whole point of surfacing this; the variable's
 * VALUE never leaves the server.
 */
export async function GET(_request: NextRequest) {
  try {
    const user = await requireUser();
    const [statuses, usage] = await Promise.all([
      Promise.resolve(getProviderStatuses()),
      getUsageSummary(user.id),
    ]);
    return jsonOk({ providers: statuses, usage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
