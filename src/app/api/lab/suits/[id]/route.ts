import type { NextRequest } from "next/server";
import { updateSuitSchema } from "@/lib/validation/labSchemas";
import { getSuit, updateSuit } from "@/lib/lab/suits";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const suit = await getSuit(user.id, id);
    if (!suit) throw new ApiError(404, "Suit not found.");
    return jsonOk({ suit });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateSuitSchema.parse(await request.json());
    const suit = await updateSuit(user.id, id, body);
    if (!suit) throw new ApiError(404, "Suit not found.");
    return jsonOk({ suit });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
