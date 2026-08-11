import { exportAllData } from "@/lib/export/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/** Full data portability export — everything VOX has stored, as one JSON document. */
export async function GET() {
  try {
    const user = await requireUser();
    const data = await exportAllData(user.id);
    return jsonOk(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
