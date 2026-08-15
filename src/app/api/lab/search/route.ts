import type { NextRequest } from "next/server";
import { searchLab } from "@/lib/lab/search";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const results = await searchLab(user.id, q);
    return jsonOk({ results });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
