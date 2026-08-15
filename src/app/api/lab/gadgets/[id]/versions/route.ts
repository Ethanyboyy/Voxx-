import type { NextRequest } from "next/server";
import { createGadgetVersionSchema } from "@/lib/validation/labSchemas";
import { createGadgetVersion } from "@/lib/lab/gadgets";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createGadgetVersionSchema.parse(await request.json());
    const version = await createGadgetVersion(user.id, id, body);
    if (!version) throw new ApiError(404, "Gadget not found.");
    return jsonOk({ version }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
