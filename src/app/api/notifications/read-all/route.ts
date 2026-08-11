import { markAllNotificationsRead } from "@/lib/notifications/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST() {
  try {
    const user = await requireUser();
    await markAllNotificationsRead(user.id);
    return jsonOk({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
