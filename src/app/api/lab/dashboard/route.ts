import { getLabDashboard } from "@/lib/lab/dashboard";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const dashboard = await getLabDashboard(user.id);
    return jsonOk({ dashboard });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
