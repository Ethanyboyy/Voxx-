import { exportMemories } from "@/lib/memory/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const memories = await exportMemories(user.id);
    return jsonOk({ exportedAt: new Date().toISOString(), memories });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
