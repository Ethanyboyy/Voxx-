import type { NextRequest } from "next/server";
import { z } from "zod";
import { experimentStatusSchema } from "@/lib/validation/schemas";
import { updateExperiment } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const patchSchema = z.object({
  hypothesis: z.string().min(1).max(2000).optional(),
  method: z.string().max(5000).optional(),
  status: experimentStatusSchema.optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const experiment = await updateExperiment(user.id, id, body);
    if (!experiment) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ experiment });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
