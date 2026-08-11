import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { listAgentRuns } from "@/lib/agents/service";
import { listProjects } from "@/lib/projects/service";
import { AgentsClient } from "@/components/agents/AgentsClient";

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [runs, projects] = await Promise.all([listAgentRuns(user.id), listProjects(user.id)]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agents</h1>
      <p className="mt-1 text-sm text-muted">
        Give VOX an objective. It plans an ordered list of steps using its tool registry, then executes them one at a
        time — pausing whenever a step needs a permission you haven&apos;t granted yet. Nothing here ever bypasses
        the real permission check.
      </p>
      <Suspense>
        <AgentsClient
          initialRuns={runs.map(serializeRun)}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </Suspense>
    </div>
  );
}

function serializeRun(run: Awaited<ReturnType<typeof listAgentRuns>>[number]) {
  return {
    id: run.id,
    objective: run.objective,
    status: run.status,
    currentStep: run.currentStep,
    result: run.result,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    steps: run.steps.map((s) => ({
      id: s.id,
      order: s.order,
      description: s.description,
      toolName: s.toolName,
      input: s.input,
      output: s.output,
      status: s.status,
      capability: s.capability,
      requiredLevel: s.requiredLevel,
      error: s.error,
    })),
  };
}
