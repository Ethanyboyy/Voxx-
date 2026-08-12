import type { NextRequest } from "next/server";
import { researchRequestSchema } from "@/lib/validation/schemas";
import { listResearchItems, runResearch } from "@/lib/research/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const opportunityId = new URL(request.url).searchParams.get("opportunityId");
    const items = await listResearchItems(user.id, 50, opportunityId ?? undefined);
    return jsonOk({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = researchRequestSchema.parse(await request.json());
    const items = await runResearch(user.id, body.query, body.opportunityId);
    return jsonOk({ items }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
