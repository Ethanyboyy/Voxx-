import { getCurrentUser } from "@/lib/auth/session";
import { getGraph } from "@/lib/knowledge/service";
import { GraphClient } from "@/components/graph/GraphClient";

export default async function GraphPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { nodes, connections } = await getGraph(user.id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Knowledge graph</h1>
      <p className="mt-1 text-sm text-muted">
        Entities, memories, projects, and how they connect. Nodes linked to a first-class record (project, memory,
        task, ...) are created automatically when something connects to them; freestanding entities (people,
        organizations, concepts) you add here.
      </p>
      <GraphClient
        initialNodes={nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }))}
        initialConnections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      />
    </div>
  );
}
