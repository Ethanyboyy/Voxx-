import { listRecentEvents } from "@/lib/observability/events";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const events = await listRecentEvents(user.id);
    return jsonOk({ events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
