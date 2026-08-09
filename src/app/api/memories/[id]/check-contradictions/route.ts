import { checkForContradictions } from "@/lib/memory/contradictions";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/** On-demand, same posture as /api/patterns/detect — never runs silently in the background. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const proposals = await checkForContradictions(user.id, id);
    return jsonOk({ proposals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
