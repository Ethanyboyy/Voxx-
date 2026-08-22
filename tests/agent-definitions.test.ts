import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createAgent, listAgents, getAgent, updateAgent, deleteAgent } from "@/lib/agents/agents";
import { startAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { grantPermission } from "@/lib/permissions/service";
import { subscribeToEvents, type LiveEvent } from "@/lib/events/bus";
import { createTestUser } from "./helpers";

describe("Agent definitions (persistent Agent CRUD)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates an agent with a default empty capability allowlist", async () => {
    const agent = await createAgent({ userId, name: "Bare agent" });
    expect(agent.status).toBe("DRAFT");
    expect(agent.allowedCapabilities).toEqual([]);
  });

  it("creates, lists, gets, updates, and deletes an agent", async () => {
    const created = await createAgent({
      userId,
      name: "Research assistant",
      description: "Runs research and files notes.",
      allowedCapabilities: ["research.web"],
    });
    expect(created.allowedCapabilities).toEqual(["research.web"]);

    const listed = await listAgents(userId);
    expect(listed.some((a) => a.id === created.id)).toBe(true);

    const fetched = await getAgent(userId, created.id);
    expect(fetched?.name).toBe("Research assistant");

    const updated = await updateAgent(userId, created.id, { status: "READY", allowedCapabilities: ["research.web", "memory.write"] });
    expect(updated?.status).toBe("READY");
    expect(updated?.allowedCapabilities).toEqual(["research.web", "memory.write"]);

    const deleted = await deleteAgent(userId, created.id);
    expect(deleted).toBe(true);
    expect(await getAgent(userId, created.id)).toBeNull();
  });

  it("scopes agents to their owner", async () => {
    const otherUser = await createTestUser();
    const agent = await createAgent({ userId: otherUser.id, name: "Not yours" });
    expect(await getAgent(userId, agent.id)).toBeNull();
    expect(await updateAgent(userId, agent.id, { status: "READY" })).toBeNull();
    expect(await deleteAgent(userId, agent.id)).toBe(false);
  });
});

describe("Agent-level capability allowlist enforcement (executor)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    // Grant the user's own permission generously — the allowlist is a
    // separate, stricter restriction and must still bind even when the
    // user's own Permission grant would otherwise allow the tool.
    await grantPermission(userId, "project.write", "RECOMMEND");
  });

  it("fails a run outright (not WAITING_FOR_PERMISSION) when the agent's allowlist doesn't include the step's capability", async () => {
    const agent = await createAgent({ userId, name: "No-tools agent", allowedCapabilities: [] });
    const run = await db.agentRun.create({
      data: { userId, agentId: agent.id, objective: "Create a task the agent isn't allowed to create.", status: "PLANNING" },
    });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Create a task",
        toolName: "task.create",
        input: JSON.stringify({ title: "Should never exist" }),
        requiredLevel: "RECOMMEND",
      },
    });

    const result = await executeRun(userId, run.id);
    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/not permitted to use capability/i);
    expect(result.steps[0]!.status).toBe("FAILED");

    const created = await db.task.findFirst({ where: { userId, title: "Should never exist" } });
    expect(created).toBeNull();
  });

  it("runs the tool successfully once the capability is in the agent's allowlist", async () => {
    const agent = await createAgent({ userId, name: "Task-capable agent", allowedCapabilities: ["project.write"] });
    const run = await db.agentRun.create({
      data: { userId, agentId: agent.id, objective: "Create a task the agent is allowed to create.", status: "PLANNING" },
    });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Create a task",
        toolName: "task.create",
        input: JSON.stringify({ title: "Created by an allowlisted agent" }),
        requiredLevel: "RECOMMEND",
      },
    });

    const result = await executeRun(userId, run.id);
    expect(result.status).toBe("COMPLETED");

    const created = await db.task.findFirst({ where: { userId, title: "Created by an allowlisted agent" } });
    expect(created).not.toBeNull();
  });

  it("ad hoc runs (no agentId) are unaffected by any agent's allowlist", async () => {
    const run = await startAgentRun({ userId, objective: "Say hello." });
    expect(run.status).toBe("COMPLETED");
  });

  it("startAgentRun rejects starting a run under another user's agent", async () => {
    const otherUser = await createTestUser();
    const agent = await createAgent({ userId: otherUser.id, name: "Someone else's agent", allowedCapabilities: ["project.write"] });
    await expect(startAgentRun({ userId, objective: "Try to hijack an agent.", agentId: agent.id })).rejects.toThrow(/not found/i);
  });

  it("startAgentRun rejects starting a run under an archived agent", async () => {
    const agent = await createAgent({ userId, name: "Retired agent", allowedCapabilities: ["project.write"] });
    await updateAgent(userId, agent.id, { status: "ARCHIVED" });
    await expect(startAgentRun({ userId, objective: "Try to use a retired agent.", agentId: agent.id })).rejects.toThrow(/archived/i);
  });
});

describe("cross-domain integration: Agent -> Tool Registry -> real Lab service -> live event bus", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    await grantPermission(userId, "lab.write", "RECOMMEND");
  });

  it("an agent run using lab.create_requirement writes a real LabRequirement row and broadcasts real live events", async () => {
    const agent = await createAgent({ userId, name: "Lab engineer", allowedCapabilities: ["lab.write"] });
    const run = await db.agentRun.create({
      data: { userId, agentId: agent.id, objective: "Record an engineering requirement.", status: "PLANNING" },
    });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Record a requirement",
        toolName: "lab.create_requirement",
        input: JSON.stringify({ title: "Webbing must survive -20C", priority: "HIGH" }),
        requiredLevel: "RECOMMEND",
      },
    });

    const received: LiveEvent[] = [];
    const unsubscribe = subscribeToEvents(userId, (event) => received.push(event));

    try {
      const result = await executeRun(userId, run.id);
      expect(result.status).toBe("COMPLETED");

      const requirement = await db.labRequirement.findFirst({ where: { userId, title: "Webbing must survive -20C" } });
      expect(requirement).not.toBeNull();
      expect(requirement!.priority).toBe("HIGH");

      // Real live-bus delivery, not a fabricated assertion: recordEvent() inside
      // createRequirement() published this over the same in-process bus the SSE
      // route reads from, and the executor published its own run-lifecycle events.
      expect(received.some((e) => e.type === "lab.requirement.created" && e.subjectId === requirement!.id)).toBe(true);
      expect(received.some((e) => e.type === "agent.run.completed" && e.subjectId === run.id)).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
