import { getCurrentUser } from "@/lib/auth/session";
import { getGraph } from "@/lib/knowledge/service";
import { listPatterns } from "@/lib/cognition/patterns";
import { listMemories } from "@/lib/memory/service";
import { listProjects, listGoals, listTasks, listDecisions } from "@/lib/projects/service";
import { listAgentRuns } from "@/lib/agents/service";
import { listConnections } from "@/lib/connections/service";
import { listRecentEvents } from "@/lib/observability/events";
import { VoxBrainClient } from "@/components/brain/VoxBrainClient";

export default async function BrainPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [graph, patterns, memories, projects, goals, tasks, decisions, agentRuns, connections, events] =
    await Promise.all([
      getGraph(user.id),
      listPatterns(user.id),
      listMemories(user.id),
      listProjects(user.id),
      listGoals(user.id),
      listTasks(user.id),
      listDecisions(user.id),
      listAgentRuns(user.id, 10),
      listConnections(user.id),
      listRecentEvents(user.id, 30),
    ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">VOX Brain</h1>
      <p className="mt-1 text-sm text-muted">
        A live map of what VOX currently knows and is doing — not a window into its private reasoning, just the
        safe, high-level state: memory, knowledge, plans, and activity.
      </p>

      <VoxBrainClient
        nodes={graph.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
          description: n.description,
          memoryId: n.memoryId,
          projectId: n.projectId,
          goalId: n.goalId,
        }))}
        connections={graph.connections.map((c) => ({ id: c.id, fromNodeId: c.fromNodeId, toNodeId: c.toNodeId, relation: c.relation }))}
        patterns={patterns.map((p) => ({
          id: p.id,
          type: p.type,
          description: p.description,
          status: p.status,
          occurrenceCount: p.occurrenceCount,
        }))}
        memoryStats={{
          total: memories.length,
          byConfidence: countBy(memories, (m) => m.confidence),
          byCategory: countBy(memories, (m) => m.category),
          recent: memories.slice(0, 8).map((m) => ({ id: m.id, content: m.content, category: m.category, confidence: m.confidence })),
        }}
        planning={{
          activeProjects: projects.filter((p) => p.status === "ACTIVE").map((p) => ({ id: p.id, name: p.name })),
          activeGoals: goals.filter((g) => g.status === "ACTIVE").map((g) => ({ id: g.id, title: g.title })),
          openTasks: tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS").length,
          pendingDecisions: decisions.filter((d) => d.status === "PENDING").map((d) => ({ id: d.id, title: d.title })),
        }}
        execution={{
          agentRuns: agentRuns.map((r) => ({ id: r.id, objective: r.objective, status: r.status, stepCount: r.steps.length })),
        }}
        connectionsSummary={connections.map((c) => ({
          service: c.catalog.service,
          displayName: c.catalog.displayName,
          status: c.status,
        }))}
        activity={events.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt.toISOString(), consequential: e.consequential }))}
      />
    </div>
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
