import type { NextRequest } from "next/server";
import { z } from "zod";
import { supersedeMemory } from "@/lib/memory/relations";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const bodySchema = z.object({
  supersedesId: z.string().min(1),
  note: z.string().max(2000).optional(),
});

/** `id` (the new memory) supersedes `supersedesId` (the old one). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const relation = await supersedeMemory(user.id, id, body.supersedesId, body.note);
    if (!relation) throw new ApiError(404, "One or both memories were not found.");
    return jsonOk({ relation }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
