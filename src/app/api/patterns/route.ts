import { listPatterns } from "@/lib/cognition/patterns";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const patterns = await listPatterns(user.id);
    return jsonOk({ patterns });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
