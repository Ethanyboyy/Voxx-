import type { NextRequest } from "next/server";
import { getTrainingModule } from "@/lib/lab/training";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const trainingModule = await getTrainingModule(id);
    if (!trainingModule) throw new ApiError(404, "Training module not found.");
    return jsonOk({ module: trainingModule });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
