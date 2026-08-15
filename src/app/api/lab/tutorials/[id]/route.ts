import type { NextRequest } from "next/server";
import { getTutorial } from "@/lib/lab/tutorials";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const tutorial = await getTutorial(user.id, id);
    if (!tutorial) throw new ApiError(404, "Tutorial not found.");
    return jsonOk({ tutorial });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
