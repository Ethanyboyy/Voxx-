import type { NextRequest } from "next/server";
import { updateObjectiveSchema } from "@/lib/validation/schemas";
import { deleteObjective, getObjective, updateObjective } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const objective = await getObjective(user.id, id);
    if (!objective) throw new ApiError(404, "Objective not found.");
    return jsonOk({ objective });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateObjectiveSchema.parse(await request.json());
    const objective = await updateObjective(user.id, id, body);
    if (!objective) throw new ApiError(404, "Objective not found.");
    return jsonOk({ objective });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteObjective(user.id, id);
    if (!deleted) throw new ApiError(404, "Objective not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
