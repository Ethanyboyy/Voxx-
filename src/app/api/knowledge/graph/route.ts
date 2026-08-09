import { getGraph } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const graph = await getGraph(user.id);
    return jsonOk(graph);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
