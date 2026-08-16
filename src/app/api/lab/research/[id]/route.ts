import type { NextRequest } from "next/server";
import { updateResearchItemSchema } from "@/lib/validation/labSchemas";
import { getResearchItem, updateResearchItem, deleteResearchItem } from "@/lib/lab/research";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const item = await getResearchItem(user.id, id);
    if (!item) throw new ApiError(404, "Research item not found.");
    return jsonOk({ item });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateResearchItemSchema.parse(await request.json());
    const item = await updateResearchItem(user.id, id, body);
    if (!item) throw new ApiError(404, "Research item not found.");
    return jsonOk({ item });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteResearchItem(user.id, id);
    if (!deleted) throw new ApiError(404, "Research item not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
