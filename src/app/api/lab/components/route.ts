import type { NextRequest } from "next/server";
import { createComponentSchema } from "@/lib/validation/labSchemas";
import { createComponent, getComponentTree } from "@/lib/lab/components";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const suitId = url.searchParams.get("suitId") ?? undefined;
    const gadgetId = url.searchParams.get("gadgetId") ?? undefined;
    if (!suitId && !gadgetId) throw new ApiError(400, "Provide suitId or gadgetId.");
    const tree = await getComponentTree({ suitId, gadgetId });
    return jsonOk({ tree });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = createComponentSchema.parse(await request.json());
    if (!body.suitId && !body.gadgetId) throw new ApiError(400, "Provide suitId or gadgetId.");
    const component = await createComponent(body);
    return jsonOk({ component }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
