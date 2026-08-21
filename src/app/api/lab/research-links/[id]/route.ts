import type { NextRequest } from "next/server";
import { deleteResearchLink } from "@/lib/lab/researchLinks";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteResearchLink(user.id, id);
    if (!deleted) throw new ApiError(404, "Research link not found.");
    return jsonOk({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
