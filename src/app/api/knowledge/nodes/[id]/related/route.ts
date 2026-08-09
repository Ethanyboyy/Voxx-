import type { NextRequest } from "next/server";
import { findRelated } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const depth = Number(new URL(request.url).searchParams.get("depth") ?? "1");
    const related = await findRelated(user.id, id, depth);
    return jsonOk({ related });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
