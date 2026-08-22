import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { listAgentRuns } from "@/lib/agents/service";
import { listAgents } from "@/lib/agents/agents";
import { listProjects } from "@/lib/projects/service";
import { listTools } from "@/lib/tools/registry";
import { AgentsClient } from "@/components/agents/AgentsClient";

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [runs, agents, projects] = await Promise.all([listAgentRuns(user.id), listAgents(user.id), listProjects(user.id)]);
  const capabilityOptions = Array.from(new Set(listTools().map((t) => t.capability))).sort();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <p className="vox-eyebrow">Execution</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Agents</h1>
      <p className="mt-1.5 text-sm text-muted">
        Give VOX an objective. It plans an ordered list of steps using its tool registry, then executes them one at a
        time — pausing whenever a step needs a permission you haven&apos;t granted yet. Nothing here ever bypasses
        the real permission check. Saved agents add a second restriction on top: an allowlist of capabilities that
        agent&apos;s runs may ever use, independent of what you&apos;ve personally granted.
      </p>
      <Suspense>
        <AgentsClient
          initialRuns={runs.map(serializeRun)}
          initialAgents={agents.map(serializeAgent)}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          capabilityOptions={capabilityOptions}
        />
      </Suspense>
    </div>
  );
}

function serializeAgent(agent: Awaited<ReturnType<typeof listAgents>>[number]) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    status: agent.status,
    allowedCapabilities: agent.allowedCapabilities,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function serializeRun(run: Awaited<ReturnType<typeof listAgentRuns>>[number]) {
  return {
    id: run.id,
    objective: run.objective,
    agentId: run.agentId,
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
