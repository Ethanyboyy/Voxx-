import { getBrainGraph, getBrainState } from "@/lib/brain/graph";
import { getBrainActivity } from "@/lib/brain/activity";
import { listRecentEvents } from "@/lib/observability/events";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const [graph, brain, activity, events] = await Promise.all([
      getBrainGraph(user.id),
      getBrainState(user.id),
      getBrainActivity(user.id),
      listRecentEvents(user.id, 60),
    ]);
    return jsonOk({
      ...graph,
      brain,
      activity: {
        intensity: activity.intensity,
        runningRuns: activity.snapshot.runningRuns,
        activeCapabilityRuns: activity.snapshot.activeCapabilityRuns,
        attempt: activity.snapshot.iteration?.attempt ?? null,
      },
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
