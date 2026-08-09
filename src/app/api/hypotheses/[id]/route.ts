import type { NextRequest } from "next/server";
import { updateHypothesisSchema } from "@/lib/validation/schemas";
import { updateHypothesisStatus } from "@/lib/cognition/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateHypothesisSchema.parse(await request.json());
    const hypothesis = await updateHypothesisStatus(user.id, id, body.status, body.confidence);
    if (!hypothesis) throw new ApiError(404, "Hypothesis not found.");
    return jsonOk({ hypothesis });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
