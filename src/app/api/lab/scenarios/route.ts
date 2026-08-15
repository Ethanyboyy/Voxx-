import type { NextRequest } from "next/server";
import { createScenarioSchema } from "@/lib/validation/labSchemas";
import { createScenario, listScenarios } from "@/lib/lab/scenarios";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const scenarios = await listScenarios(user.id);
    return jsonOk({ scenarios });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createScenarioSchema.parse(await request.json());
    const scenario = await createScenario({ userId: user.id, isCustom: true, ...body });
    return jsonOk({ scenario }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
