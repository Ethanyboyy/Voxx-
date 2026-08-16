import { getCurrentUser } from "@/lib/auth/session";
import { getGraph } from "@/lib/knowledge/service";
import { GraphClient } from "@/components/graph/GraphClient";

export default async function GraphPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { nodes, connections } = await getGraph(user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Knowledge</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Knowledge graph</h1>
      <p className="mt-1.5 text-sm text-muted">
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
