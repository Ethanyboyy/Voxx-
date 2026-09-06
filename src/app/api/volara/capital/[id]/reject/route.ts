/**
 * [P4-F] The human "no" on a capital request.
 *
 * Creates no `ApprovalGrant` and reserves nothing — `rejectCapitalAllocation()`
 * does not import the grant constructor at all, exactly as
 * `rejectAgentStep()` does not. A rejection must never be able to authorize.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { rejectCapitalAllocation } from "@/lib/volara/governor";

type Context = { params: Promise<{ id: string }> };

const rejectSchema = z.object({ reason: z.string().min(1).max(1000) });

export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = rejectSchema.parse(await request.json().catch(() => ({ reason: "Declined." })));

    const result = await rejectCapitalAllocation(user.id, id, body.reason);
    if (!result.rejected) {
      throw new ApiError(409, "That allocation is not awaiting a decision.");
    }
    return jsonOk({ rejected: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
