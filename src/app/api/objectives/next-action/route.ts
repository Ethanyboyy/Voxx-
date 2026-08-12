import { getNextBestAction } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const nextBestAction = await getNextBestAction(user.id);
    return jsonOk({ nextBestAction });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
