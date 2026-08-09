import type { NextRequest } from "next/server";
import { z } from "zod";
import { decisionStatusSchema } from "@/lib/validation/schemas";
import { updateDecision } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  chosenOption: z.string().max(500).optional(),
  status: decisionStatusSchema.optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const decision = await updateDecision(user.id, id, body);
    if (!decision) throw new ApiError(404, "Decision not found.");
    return jsonOk({ decision });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
