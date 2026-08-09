import type { NextRequest } from "next/server";
import { semanticSearchSchema } from "@/lib/validation/schemas";
import { getSemanticMemories } from "@/lib/memory/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const body = semanticSearchSchema.parse({
      query: searchParams.get("query") ?? "",
      limit: searchParams.get("limit") ?? undefined,
    });
    const memories = await getSemanticMemories(user.id, body.query, body.limit ?? 8);
    return jsonOk({ memories });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
