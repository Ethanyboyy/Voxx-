import { getCognitiveProfile } from "@/lib/cognition/profile";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const profile = await getCognitiveProfile(user.id);
    return jsonOk({ profile });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
