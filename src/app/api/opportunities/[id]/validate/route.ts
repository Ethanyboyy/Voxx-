import type { NextRequest } from "next/server";
import { createValidationObjectiveSchema } from "@/lib/validation/schemas";
import { createValidationObjective } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** Turns an Opportunity into a real Objective the Supervisor can pursue —
 * the Economic Engine's Opportunity -> Objective bridge. Does not start any
 * execution itself; use /api/supervisor with the returned objective's id. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createValidationObjectiveSchema.parse(await request.json().catch(() => ({})));
    const result = await createValidationObjective({ userId: user.id, opportunityId: id, ...body });
    if (!result) throw new ApiError(404, "Opportunity not found.");
    return jsonOk(result, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
