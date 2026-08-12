import type { NextRequest } from "next/server";
import { updateBrainGroupSchema } from "@/lib/validation/schemas";
import { deleteBrainGroup, updateBrainGroup } from "@/lib/brain/groups";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateBrainGroupSchema.parse(await request.json());
    const group = await updateBrainGroup(user.id, id, body);
    if (!group) throw new ApiError(404, "Group not found.");
    return jsonOk({ group });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteBrainGroup(user.id, id);
    if (!deleted) throw new ApiError(404, "Group not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
