import type { NextRequest } from "next/server";
import { createDecisionSchema } from "@/lib/validation/labSchemas";
import { createDecision, listDecisions } from "@/lib/lab/decisions";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const suitId = new URL(request.url).searchParams.get("suitId") ?? undefined;
    const decisions = await listDecisions(user.id, suitId);
    return jsonOk({ decisions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createDecisionSchema.parse(await request.json());
    const decision = await createDecision({ userId: user.id, ...body });
    return jsonOk({ decision }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
