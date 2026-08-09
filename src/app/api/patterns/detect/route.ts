import { detectPatterns } from "@/lib/cognition/patterns";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST() {
  try {
    const user = await requireUser();
    const patterns = await detectPatterns(user.id);
    return jsonOk({ patterns });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
