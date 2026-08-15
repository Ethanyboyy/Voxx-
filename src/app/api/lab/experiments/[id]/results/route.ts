import type { NextRequest } from "next/server";
import { addExperimentResultSchema } from "@/lib/validation/labSchemas";
import { addExperimentResult } from "@/lib/lab/experiments";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = addExperimentResultSchema.parse(await request.json());
    const result = await addExperimentResult(user.id, id, body);
    if (!result) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ result }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
