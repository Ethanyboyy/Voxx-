import { deleteSuitImage } from "@/lib/lab/suitImages";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  try {
    const user = await requireUser();
    const { id, imageId } = await context.params;
    const deleted = await deleteSuitImage(user.id, id, imageId);
    if (!deleted) throw new ApiError(404, "Image not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
