import type { NextRequest } from "next/server";
import { createGoalSchema } from "@/lib/validation/schemas";
import { deleteGoal, updateGoal } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const patchSchema = createGoalSchema.partial();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const goal = await updateGoal(user.id, id, body);
    if (!goal) throw new ApiError(404, "Goal not found.");
    return jsonOk({ goal });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteGoal(user.id, id);
    if (!deleted) throw new ApiError(404, "Goal not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
