import type { NextRequest } from "next/server";
import { updateMemorySchema } from "@/lib/validation/schemas";
import { deleteMemory, getMemory, updateMemory } from "@/lib/memory/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const memory = await getMemory(user.id, id);
    if (!memory) throw new ApiError(404, "Memory not found.");
    return jsonOk({ memory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateMemorySchema.parse(await request.json());
    const memory = await updateMemory(user.id, id, body);
    if (!memory) throw new ApiError(404, "Memory not found.");
    return jsonOk({ memory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteMemory(user.id, id);
    if (!deleted) throw new ApiError(404, "Memory not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
