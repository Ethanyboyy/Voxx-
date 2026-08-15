import { getTrainingProgress } from "@/lib/lab/training";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const progress = await getTrainingProgress(user.id);
    return jsonOk({ progress });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
