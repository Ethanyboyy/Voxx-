import type { NextRequest } from "next/server";
import { updateRequirementSchema } from "@/lib/validation/labSchemas";
import { getRequirement, updateRequirement, deleteRequirement } from "@/lib/lab/requirements";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const requirement = await getRequirement(user.id, id);
    if (!requirement) throw new ApiError(404, "Requirement not found.");
    return jsonOk({ requirement });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateRequirementSchema.parse(await request.json());
    const requirement = await updateRequirement(user.id, id, body);
    if (!requirement) throw new ApiError(404, "Requirement not found.");
    return jsonOk({ requirement });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteRequirement(user.id, id);
    if (!deleted) throw new ApiError(404, "Requirement not found.");
    return jsonOk({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
