import type { NextRequest } from "next/server";
import { createKnowledgeConnectionSchema } from "@/lib/validation/schemas";
import { createConnection } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createKnowledgeConnectionSchema.parse(await request.json());
    const connection = await createConnection({ userId: user.id, ...body });
    if (!connection) throw new ApiError(404, "One or both nodes were not found.");
    return jsonOk({ connection }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
