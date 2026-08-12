import type { NextRequest } from "next/server";
import { getSemanticMemories } from "@/lib/memory/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/**
 * On-demand "retrieve relevant context" for a Brain workspace selection —
 * real semantic memory retrieval (the same ranking buildSystemPrompt uses),
 * run against the selected entity's own text. Not a stored relationship:
 * recomputed live each time, same honesty posture as chat's memory retrieval.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    if (!query || !query.trim()) throw new ApiError(400, "Missing query.");
    const memories = await getSemanticMemories(user.id, query, 6);
    return jsonOk({ memories });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
