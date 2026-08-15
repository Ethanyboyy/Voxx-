import type { NextRequest } from "next/server";
import { updateExperimentSchema } from "@/lib/validation/labSchemas";
import { getExperiment, updateExperiment } from "@/lib/lab/experiments";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const experiment = await getExperiment(user.id, id);
    if (!experiment) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ experiment });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateExperimentSchema.parse(await request.json());
    const experiment = await updateExperiment(user.id, id, body);
    if (!experiment) throw new ApiError(404, "Experiment not found.");
    return jsonOk({ experiment });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
