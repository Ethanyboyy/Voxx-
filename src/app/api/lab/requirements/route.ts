import type { NextRequest } from "next/server";
import { createRequirementSchema } from "@/lib/validation/labSchemas";
import { createRequirement, listRequirements, nextRequirementCode } from "@/lib/lab/requirements";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const suitId = new URL(request.url).searchParams.get("suitId") ?? undefined;
    const requirements = await listRequirements(user.id, suitId);
    return jsonOk({ requirements });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createRequirementSchema.parse(await request.json());
    const code = await nextRequirementCode(user.id);
    const requirement = await createRequirement({ userId: user.id, ...body, code });
    return jsonOk({ requirement }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
