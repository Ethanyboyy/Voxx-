import { getCurrentUser } from "@/lib/auth/session";
import { getGraph } from "@/lib/knowledge/service";
import { GraphClient } from "@/components/graph/GraphClient";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function GraphPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { nodes, connections } = await getGraph(user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Knowledge"
        title="Knowledge graph"
        description={
          <>
            Entities, memories, projects, and how they connect. Much of this graph now writes itself: a supervised
            run links its objective to the outcome it produced, a research query links its sources to what was
            found, and a Lab experiment or simulation links to the result it recorded. Freestanding entities —
            people, organizations, concepts — are the ones you add here.
          </>
        }
      />
      <GraphClient
        initialNodes={nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }))}
        initialConnections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      />
    </div>
  );
}
