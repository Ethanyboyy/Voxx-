import type { NextRequest } from "next/server";
import { duplicateSuitSchema } from "@/lib/validation/labSchemas";
import { duplicateSuit } from "@/lib/lab/suits";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { newCodename } = duplicateSuitSchema.parse(await request.json());
    const suit = await duplicateSuit(user.id, id, newCodename);
    if (!suit) throw new ApiError(404, "Suit not found.");
    return jsonOk({ suit }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
