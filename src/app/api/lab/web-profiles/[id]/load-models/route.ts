import type { NextRequest } from "next/server";
import { addLoadModelSchema } from "@/lib/validation/labSchemas";
import { addLoadModel } from "@/lib/lab/webLab";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = addLoadModelSchema.parse(await request.json());
    const model = await addLoadModel(user.id, id, body);
    if (!model) throw new ApiError(404, "Web profile not found.");
    return jsonOk({ model }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
