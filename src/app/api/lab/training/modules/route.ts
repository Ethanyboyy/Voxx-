import type { NextRequest } from "next/server";
import { listTrainingModules } from "@/lib/lab/training";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const category = new URL(request.url).searchParams.get("category") ?? undefined;
    const modules = await listTrainingModules(category);
    return jsonOk({ modules });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
