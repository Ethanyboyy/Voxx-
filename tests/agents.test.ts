import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { startAgentRun, getAgentRun, resumeAgentRun, cancelAgentRun } from "@/lib/agents/service";
import { grantPermission } from "@/lib/permissions/service";
import { createTestUser } from "./helpers";

describe("agent planner + executor", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("startAgentRun plans and runs to completion with the mock provider's honest single-step fallback", async () => {
    const run = await startAgentRun({ userId, objective: "Say hello." });
    expect(run.status).toBe("COMPLETED");
    expect(run.steps.length).toBeGreaterThan(0);
    expect(run.steps.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED")).toBe(true);
  });

  it("pauses at WAITING_FOR_PERMISSION for a tool-bound step whose capability isn't granted, then resumes once granted", async () => {
    const run = await db.agentRun.create({ data: { userId, objective: "Create a task via the tool registry.", status: "PLANNING" } });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Create a task",
        toolName: "task.create",
        input: JSON.stringify({ title: "From an agent run" }),
        requiredLevel: "OBSERVE",
      },
    });

    const { executeRun } = await import("@/lib/agents/executor");
    const waiting = await executeRun(userId, run.id);
    expect(waiting.status).toBe("WAITING_FOR_PERMISSION");
    expect(waiting.steps[0]!.status).toBe("WAITING_FOR_PERMISSION");
    expect(waiting.steps[0]!.capability).toBe("project.write");

    // Resuming before granting the permission stays parked — never bypasses the check.
    const stillWaiting = await resumeAgentRun(userId, run.id);
    expect(stillWaiting!.status).toBe("WAITING_FOR_PERMISSION");

    await grantPermission(userId, "project.write", "RECOMMEND");
    const resumed = await resumeAgentRun(userId, run.id);
    expect(resumed!.status).toBe("COMPLETED");
    const afterResume = await getAgentRun(userId, run.id);
    expect(afterResume!.steps[0]!.status).toBe("COMPLETED");

    const created = await db.task.findFirst({ where: { userId, title: "From an agent run" } });
    expect(created).not.toBeNull();
  });

  it("fails the run and marks the step FAILED when the planner references a tool that doesn't exist", async () => {
    const run = await db.agentRun.create({ data: { userId, objective: "Use a fake tool.", status: "PLANNING" } });
    await db.agentStep.create({
      data: { runId: run.id, order: 0, description: "Do something imaginary", toolName: "not.a.real.tool", requiredLevel: "OBSERVE" },
    });
    const { executeRun } = await import("@/lib/agents/executor");
    const failed = await executeRun(userId, run.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/unknown tool/i);
  });

  it("cancelAgentRun marks the run CANCELLED and skips remaining pending steps", async () => {
    const run = await db.agentRun.create({ data: { userId, objective: "Cancel me.", status: "RUNNING" } });
    await db.agentStep.create({ data: { runId: run.id, order: 0, description: "pending step", requiredLevel: "OBSERVE" } });

    const cancelled = await cancelAgentRun(userId, run.id);
    expect(cancelled!.status).toBe("CANCELLED");

    const fetched = await getAgentRun(userId, run.id);
    expect(fetched!.steps[0]!.status).toBe("SKIPPED");
  });

  it("scopes runs to their owner", async () => {
    const otherUser = await createTestUser();
    const run = await startAgentRun({ userId: otherUser.id, objective: "Not yours." });
    expect(await getAgentRun(userId, run.id)).toBeNull();
    expect(await cancelAgentRun(userId, run.id)).toBeNull();
  });
});
