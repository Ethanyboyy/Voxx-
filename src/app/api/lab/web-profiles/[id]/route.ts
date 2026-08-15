import type { NextRequest } from "next/server";
import { getWebProfile } from "@/lib/lab/webLab";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const profile = await getWebProfile(user.id, id);
    if (!profile) throw new ApiError(404, "Web profile not found.");
    return jsonOk({ profile });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
