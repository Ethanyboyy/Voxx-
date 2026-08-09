import type { NextRequest } from "next/server";
import { researchRequestSchema } from "@/lib/validation/schemas";
import { listResearchItems, runResearch } from "@/lib/research/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listResearchItems(user.id);
    return jsonOk({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = researchRequestSchema.parse(await request.json());
    const items = await runResearch(user.id, body.query);
    return jsonOk({ items }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
