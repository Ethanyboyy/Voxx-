import { getBrainGraph, getBrainState } from "@/lib/brain/graph";
import { listRecentEvents } from "@/lib/observability/events";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const [graph, brain, events] = await Promise.all([
      getBrainGraph(user.id),
      getBrainState(user.id),
      listRecentEvents(user.id, 60),
    ]);
    return jsonOk({
      ...graph,
      brain,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
