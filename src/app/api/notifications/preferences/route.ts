import type { NextRequest } from "next/server";
import { updateNotificationPreferenceSchema } from "@/lib/validation/schemas";
import { getNotificationPreference, updateNotificationPreference } from "@/lib/notifications/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const preference = await getNotificationPreference(user.id);
    return jsonOk({ preference });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = updateNotificationPreferenceSchema.parse(await request.json());
    const preference = await updateNotificationPreference(user.id, body);
    return jsonOk({ preference });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
