import type { NextRequest } from "next/server";
import { createOpportunitySchema } from "@/lib/validation/schemas";
import { createOpportunity, listOpportunities } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const objectiveId = new URL(request.url).searchParams.get("objectiveId");
    const opportunities = await listOpportunities(user.id, objectiveId ?? undefined);
    return jsonOk({ opportunities });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createOpportunitySchema.parse(await request.json());
    const opportunity = await createOpportunity({ userId: user.id, ...body });
    if (!opportunity) throw new ApiError(404, "Objective not found.");
    return jsonOk({ opportunity }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
