import { db } from "@/lib/db";
import { checkCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { getTool } from "@/lib/tools/registry";
import type { AgentRun, AgentStep } from "@/generated/prisma/client";

const MAX_RETRIES = 1;

/**
 * The execution engine (§14): runs an AgentRun's steps in order, one at a
 * time. Every tool-bound step goes through the exact same checkCapability()
 * used everywhere else in VOX — a denied/ungranted capability pauses the
 * run at WAITING_FOR_PERMISSION rather than skipping or bypassing the
 * check. Never marks a step COMPLETED unless its tool actually returned
 * successfully (§30 — never claim success falsely).
 */
export async function executeRun(userId: string, runId: string): Promise<AgentRun & { steps: AgentStep[] }> {
  let run = await db.agentRun.findFirst({ where: { id: runId, userId }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!run) throw new Error("Agent run not found.");
  if (run.status === "COMPLETED" || run.status === "CANCELLED" || run.status === "FAILED") return run;

  if (run.status === "PLANNING") {
    run = await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING" }, include: { steps: { orderBy: { order: "asc" } } } });
    await recordEvent({ userId, type: "agent.run.started", subjectType: "AgentRun", subjectId: run.id, payload: { objective: run.objective } });
  }

  for (const step of run.steps) {
    if (step.order < run.currentStep) continue;
    if (step.status === "COMPLETED" || step.status === "SKIPPED") continue;

    if (!step.toolName) {
      await db.agentStep.update({
        where: { id: step.id },
        data: { status: "COMPLETED", startedAt: new Date(), completedAt: new Date(), output: JSON.stringify({ note: step.description }) },
      });
      run = await advance(run.id, step.order);
      continue;
    }

    const tool = getTool(step.toolName);
    if (!tool) {
      return await failRun(userId, run.id, step.id, `Unknown tool "${step.toolName}" — the planner referenced a tool that doesn't exist in the registry.`);
    }

    const check = await checkCapability(userId, tool.capability, tool.requiredLevel);
    if (!check.allowed) {
      await db.agentStep.update({ where: { id: step.id }, data: { status: "WAITING_FOR_PERMISSION", capability: tool.capability, requiredLevel: tool.requiredLevel } });
      const waiting = await db.agentRun.update({
        where: { id: run.id },
        data: { status: "WAITING_FOR_PERMISSION", currentStep: step.order },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      await recordEvent({
        userId,
        type: "agent.step.waiting_for_permission",
        subjectType: "AgentRun",
        subjectId: run.id,
        payload: { step: step.order, tool: tool.name, capability: tool.capability, requiredLevel: tool.requiredLevel },
      });
      return waiting;
    }

    let input: unknown;
    try {
      input = step.input ? JSON.parse(step.input) : {};
    } catch {
      return await failRun(userId, run.id, step.id, "Step input was not valid JSON.");
    }
    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return await failRun(userId, run.id, step.id, `Invalid input for tool "${tool.name}": ${parsedInput.error.message}`);
    }

    await db.agentStep.update({ where: { id: step.id }, data: { status: "RUNNING", startedAt: new Date(), capability: tool.capability, requiredLevel: tool.requiredLevel } });

    let lastError: string | null = null;
    let succeeded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await tool.execute(userId, parsedInput.data as never);
        await db.agentStep.update({
          where: { id: step.id },
          data: { status: "COMPLETED", output: JSON.stringify(result.output), completedAt: new Date(), retryCount: attempt },
        });
        await recordEvent({
          userId,
          type: "agent.step.completed",
          subjectType: "AgentRun",
          subjectId: run.id,
          payload: { step: step.order, tool: tool.name, summary: result.summary },
        });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await db.agentStep.update({ where: { id: step.id }, data: { retryCount: attempt } });
      }
    }

    if (!succeeded) {
      return await failRun(userId, run.id, step.id, lastError ?? "Tool execution failed.");
    }

    run = await advance(run.id, step.order);
  }

  const completed = await db.agentRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", completedAt: new Date(), result: await summarizeRun(run.id) },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await recordEvent({ userId, type: "agent.run.completed", subjectType: "AgentRun", subjectId: run.id, consequential: true });
  return completed;
}

async function advance(runId: string, completedOrder: number) {
  return db.agentRun.update({
    where: { id: runId },
    data: { currentStep: completedOrder + 1 },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}

async function failRun(userId: string, runId: string, stepId: string, error: string) {
  await db.agentStep.update({ where: { id: stepId }, data: { status: "FAILED", error, completedAt: new Date() } });
  const failed = await db.agentRun.update({
    where: { id: runId },
    data: { status: "FAILED", error, completedAt: new Date() },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await recordEvent({ userId, type: "agent.run.failed", subjectType: "AgentRun", subjectId: runId, payload: { error }, consequential: true });
  return failed;
}

async function summarizeRun(runId: string): Promise<string> {
  const steps = await db.agentStep.findMany({ where: { runId }, orderBy: { order: "asc" } });
  const summaries = steps
    .filter((s) => s.status === "COMPLETED")
    .map((s) => {
      try {
        const parsed = s.output ? JSON.parse(s.output) : null;
        return parsed?.note ?? s.description;
      } catch {
        return s.description;
      }
    });
  return summaries.join(" ") || "Completed with no steps.";
}
