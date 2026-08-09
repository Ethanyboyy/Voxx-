import type { NextRequest } from "next/server";
import { createMemoryRelationSchema } from "@/lib/validation/schemas";
import { createMemoryRelation, listMemoryRelations } from "@/lib/memory/relations";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const relations = await listMemoryRelations(user.id, id);
    return jsonOk({ relations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createMemoryRelationSchema.parse(await request.json());
    const relation = await createMemoryRelation({
      userId: user.id,
      fromMemoryId: id,
      toMemoryId: body.toMemoryId,
      type: body.type,
      note: body.note,
      confidence: body.confidence,
    });
    if (!relation) throw new ApiError(404, "One or both memories were not found.");
    return jsonOk({ relation }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
