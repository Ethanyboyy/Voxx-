import { deleteNode } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteNode(user.id, id);
    if (!deleted) throw new ApiError(404, "Knowledge node not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
