import type { NextRequest } from "next/server";
import { listTutorials } from "@/lib/lab/tutorials";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const category = new URL(request.url).searchParams.get("category") ?? undefined;
    const tutorials = await listTutorials(user.id, category);
    return jsonOk({ tutorials });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
