import type { NextRequest } from "next/server";
import { updateOpportunitySchema } from "@/lib/validation/schemas";
import { deleteOpportunity, updateOpportunity } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateOpportunitySchema.parse(await request.json());
    const opportunity = await updateOpportunity(user.id, id, body);
    if (!opportunity) throw new ApiError(404, "Opportunity not found.");
    return jsonOk({ opportunity });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteOpportunity(user.id, id);
    if (!deleted) throw new ApiError(404, "Opportunity not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
