import { getConversation } from "@/lib/chat/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const conversation = await getConversation(user.id, id);
    if (!conversation) throw new ApiError(404, "Conversation not found.");
    return jsonOk({ conversation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
