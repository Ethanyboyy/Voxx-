import type { NextRequest } from "next/server";
import { getGadget } from "@/lib/lab/gadgets";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const gadget = await getGadget(user.id, id);
    if (!gadget) throw new ApiError(404, "Gadget not found.");
    return jsonOk({ gadget });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
