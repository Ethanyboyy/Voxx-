import type { NextRequest } from "next/server";
import { createExperimentResultSchema } from "@/lib/validation/schemas";
import { addExperimentResult } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createExperimentResultSchema.parse(await request.json());
    const result = await addExperimentResult(user.id, { experimentId: id, ...body });
    if (!result) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ result }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
