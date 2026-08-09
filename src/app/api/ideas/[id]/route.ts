import type { NextRequest } from "next/server";
import { z } from "zod";
import { ideaStatusSchema } from "@/lib/validation/schemas";
import { updateIdea } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: ideaStatusSchema.optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const idea = await updateIdea(user.id, id, body);
    if (!idea) throw new ApiError(404, "Idea not found.");
    return jsonOk({ idea });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
