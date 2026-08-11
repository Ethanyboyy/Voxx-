import type { NextRequest } from "next/server";
import { listNotifications } from "@/lib/notifications/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
    const notifications = await listNotifications(user.id, unreadOnly);
    return jsonOk({ notifications });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
