import { markNotificationRead } from "@/lib/notifications/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const notification = await markNotificationRead(user.id, id);
    if (!notification) throw new ApiError(404, "Notification not found.");
    return jsonOk({ notification });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
