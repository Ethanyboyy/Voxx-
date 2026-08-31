import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { planObjective, type PlanStep } from "@/lib/agents/planner";
import { executeRun } from "@/lib/agents/executor";
import { getTool } from "@/lib/tools/registry";

export interface StartAgentRunInput {
  userId: string;
  objective: string;
  projectId?: string;
  /** Persistent Agent definition to run under — its allowedCapabilities
   * allowlist is enforced by the executor on top of the normal permission
   * gate. Must belong to the same user and not be ARCHIVED. */
  agentId?: string;
  /** Set when this run is being driven by a SupervisorRun rather than
   * started directly from the Agent UI — see src/lib/supervisor/service.ts. */
  supervisorRunId?: string;
  /** Pre-built plan to use instead of calling planObjective() again — the
   * Supervisor already plans once itself and passes the result here so the
   * planner (still the one real planner) is only invoked a single time. */
  steps?: PlanStep[];
  /** Correlates this run with the CapabilityRun rows its steps produce.
   * Persisted so the link survives a restart — see AgentRun.traceId. */
  traceId?: string;
  /** JSON snapshot of the routed CapabilityPlan, for the workspace to show
   * why each stage exists. Never read back to drive execution. */
  plan?: string;
}

/** Plans the objective (unless a pre-built plan is given), persists the run + steps, then executes as far as it can go before hitting a permission wait, failure, or completion. */
export async function startAgentRun(input: StartAgentRunInput) {
  if (input.agentId) {
    const agent = await db.agent.findFirst({ where: { id: input.agentId, userId: input.userId } });
    if (!agent) throw new Error("Agent not found.");
    if (agent.status === "ARCHIVED") throw new Error("This agent is archived and can't start new runs.");
  }

  const run = await db.agentRun.create({
    data: {
      userId: input.userId,
      objective: input.objective,
      projectId: input.projectId,
      agentId: input.agentId,
      supervisorRunId: input.supervisorRunId,
      traceId: input.traceId,
      plan: input.plan,
      status: "PLANNING",
    },
  });
  await recordEvent({ userId: input.userId, type: "agent.run.created", subjectType: "AgentRun", subjectId: run.id, payload: { objective: input.objective } });

  const steps = input.steps ?? (await planObjective(input.objective));
  await db.agentStep.createMany({
    data: steps.map((step, index) => {
      const tool = step.toolName ? getTool(step.toolName) : undefined;
      return {
        runId: run.id,
        order: index,
        description: step.description,
        toolName: step.toolName ?? null,
        input: step.input ? JSON.stringify(step.input) : null,
        capability: tool?.capability,
        requiredLevel: tool?.requiredLevel ?? "OBSERVE",
      };
    }),
  });

  return executeRun(input.userId, run.id);
}

export async function getAgentRun(userId: string, id: string) {
  return db.agentRun.findFirst({ where: { id, userId }, include: { steps: { orderBy: { order: "asc" } } } });
}

export async function listAgentRuns(userId: string, limit = 20) {
  return db.agentRun.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, include: { steps: { orderBy: { order: "asc" } } } });
}

/** Re-attempts execution from the current step — used after the user grants the permission a step was waiting on. Never bypasses the real capability check; if it's still not granted, the run stays WAITING_FOR_PERMISSION. */
export async function resumeAgentRun(userId: string, id: string) {
  const run = await db.agentRun.findFirst({ where: { id, userId } });
  if (!run) return null;
  if (run.status !== "WAITING_FOR_PERMISSION") return run;
  return executeRun(userId, id);
}

export async function cancelAgentRun(userId: string, id: string) {
  const run = await db.agentRun.findFirst({ where: { id, userId } });
  if (!run) return null;
  if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") return run;

  await db.agentStep.updateMany({
    where: { runId: id, status: { in: ["PENDING", "RUNNING", "WAITING_FOR_PERMISSION"] } },
    data: { status: "SKIPPED" },
  });
  const cancelled = await db.agentRun.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } });
  await recordEvent({ userId, type: "agent.run.cancelled", subjectType: "AgentRun", subjectId: id, consequential: true });
  return cancelled;
}
