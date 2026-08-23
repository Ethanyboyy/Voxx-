import { getCurrentUser } from "@/lib/auth/session";
import { getBrainGraph, getBrainState } from "@/lib/brain/graph";
import { listRecentEvents } from "@/lib/observability/events";
import { BrainRouteClient } from "@/components/brain/BrainRouteClient";

export default async function BrainPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [graph, brain, events] = await Promise.all([
    getBrainGraph(user.id),
    getBrainState(user.id),
    listRecentEvents(user.id, 60),
  ]);

  return (
    <BrainRouteClient
      initial={{
        nodes: graph.nodes,
        edges: graph.edges,
        totals: graph.totals,
        brain,
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          subjectType: e.subjectType,
          subjectId: e.subjectId,
          createdAt: e.createdAt.toISOString(),
        })),
      }}
    />
  );
}
