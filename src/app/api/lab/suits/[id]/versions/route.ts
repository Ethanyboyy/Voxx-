import type { NextRequest } from "next/server";
import { createSuitVersionSchema } from "@/lib/validation/labSchemas";
import { createSuitVersion } from "@/lib/lab/suits";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createSuitVersionSchema.parse(await request.json());
    const version = await createSuitVersion(user.id, id, body);
    if (!version) throw new ApiError(404, "Suit not found.");
    return jsonOk({ version }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
