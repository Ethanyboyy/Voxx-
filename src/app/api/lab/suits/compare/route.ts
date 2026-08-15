import type { NextRequest } from "next/server";
import { compareSuits } from "@/lib/lab/suits";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const ids = new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
    if (ids.length < 2) throw new ApiError(400, "Provide at least two suit ids to compare.");
    const suits = await compareSuits(user.id, ids);
    return jsonOk({ suits });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
