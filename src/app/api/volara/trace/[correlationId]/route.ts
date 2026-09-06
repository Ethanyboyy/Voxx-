/**
 * [P4-F] Forensic reconstruction of one cycle.
 *
 * Given a correlation id, returns every transition, message, opportunity,
 * strategy, allocation, agent run and event that cycle produced. A pure read —
 * this is how "why did Volara-4 ask for $23.14" is answered without a join hunt.
 *
 * A `?allocationId=` query instead traces one allocation outward: the agent that
 * asked, the strategy and opportunity it names, the run and step that carried it
 * to a human, the `ApprovalGrant` that was spent, and the ledger rows that
 * resulted.
 */

import type { NextRequest } from "next/server";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { getCycleTrace, traceAllocation } from "@/lib/volara/observer";

type Context = { params: Promise<{ correlationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { correlationId } = await context.params;

    const allocationId = new URL(request.url).searchParams.get("allocationId");
    if (allocationId) {
      const trace = await traceAllocation(user.id, allocationId);
      if (!trace) throw new ApiError(404, "That allocation was not found.");
      return jsonOk(trace);
    }

    return jsonOk(await getCycleTrace(user.id, correlationId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
