import type { NextRequest } from "next/server";
import { searchEverything } from "@/lib/search/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const results = await searchEverything(user.id, q);
    return jsonOk({ results });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
