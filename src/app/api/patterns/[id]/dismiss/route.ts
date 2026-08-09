import { dismissPattern } from "@/lib/cognition/patterns";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const pattern = await dismissPattern(user.id, id);
    if (!pattern) throw new ApiError(404, "Pattern not found.");
    return jsonOk({ pattern });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
