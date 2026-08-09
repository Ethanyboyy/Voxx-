import type { NextRequest } from "next/server";
import { updateTaskSchema } from "@/lib/validation/schemas";
import { deleteTask, updateTask } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateTaskSchema.parse(await request.json());
    const task = await updateTask(user.id, id, {
      ...body,
      dueDate: body.dueDate ?? undefined,
    });
    if (!task) throw new ApiError(404, "Task not found.");
    return jsonOk({ task });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteTask(user.id, id);
    if (!deleted) throw new ApiError(404, "Task not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
