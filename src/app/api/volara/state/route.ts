/**
 * [P4-F] The Global Observer snapshot.
 *
 * A pure read. It creates no agents, starts no cycles and decides nothing —
 * opening an observer must never be an action, for the same reason
 * `GET .../approval` does not mint a grant.
 */

import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { getVolaraObserverState } from "@/lib/volara/observer";

export async function GET() {
  try {
    const user = await requireUser();
    const state = await getVolaraObserverState(user.id);
    return jsonOk(state);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
