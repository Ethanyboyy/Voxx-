import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { createAgent } from "@/lib/agents/agents";
import { grantPermission } from "@/lib/permissions/service";
import {
  startSupervisorRun,
  resumeSupervisorRun,
  declineSupervisorRun,
  cancelSupervisorRun,
  applyAgentRunOutcome,
  selectOrCreateAgent,
  getAutonomyMode,
  setAutonomyMode,
} from "@/lib/supervisor/service";
import { getBrainGraph } from "@/lib/brain/graph";
import { createTestUser } from "./helpers";
import type { AgentRun, AgentStep } from "@/generated/prisma/client";

async function buildToolBoundRun(userId: string, agentId: string | null, supervisorRunId: string, toolName: string, input: object) {
  const run = await db.agentRun.create({
    data: { userId, agentId, supervisorRunId, objective: "seeded step", status: "PLANNING" },
  });
  await db.agentStep.create({
    data: { runId: run.id, order: 0, description: "seeded step", toolName, input: JSON.stringify(input), requiredLevel: "RECOMMEND" },
  });
  const { executeRun } = await import("@/lib/agents/executor");
  return executeRun(userId, run.id) as Promise<AgentRun & { steps: AgentStep[] }>;
}

describe("Supervisor: full lifecycle via the real planner (mock provider fallback)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("understands an objective, selects/creates an agent, and completes autonomously", async () => {
    const objective = await createObjective({ userId, title: "Say hello to the user." });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });

    expect(supRun.status).toBe("COMPLETED");
    expect(supRun.plan).not.toBeNull();
    expect(supRun.agentId).not.toBeNull();
    expect(supRun.agentRuns.length).toBeGreaterThan(0);
    expect(supRun.agentRuns[0]!.status).toBe("COMPLETED");

    const agent = await db.agent.findUniqueOrThrow({ where: { id: supRun.agentId! } });
    expect(agent.status).toBe("READY");
  });

  it("does not fabricate objective completion — Objective.status stays whatever it already was", async () => {
    const objective = await createObjective({ userId, title: "Another real objective." });
    expect(objective.status).toBe("ACTIVE");
    await startSupervisorRun({ userId, objectiveId: objective.id });
    const reloaded = await db.objective.findUniqueOrThrow({ where: { id: objective.id } });
    expect(reloaded.status).toBe("ACTIVE");
  });

  it("rejects an objective that doesn't belong to the user", async () => {
    const otherUser = await createTestUser();
    const objective = await createObjective({ userId: otherUser.id, title: "Not yours." });
    await expect(startSupervisorRun({ userId, objectiveId: objective.id })).rejects.toThrow(/not found/i);
  });
});

describe("Supervisor: capability-based agent selection", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("reuses an existing non-archived agent whose allowlist already covers what's needed", async () => {
    const existing = await createAgent({ userId, name: "Research-capable", allowedCapabilities: ["research.web", "memory.read"] });
    const selected = await selectOrCreateAgent(userId, ["research.web"], "Some objective");
    expect(selected.id).toBe(existing.id);
  });

  it("creates a new agent scoped to exactly the required capabilities when no match exists", async () => {
    const selected = await selectOrCreateAgent(userId, ["lab.write"], "Investigate a Lab question");
    expect(JSON.parse(selected.allowedCapabilities)).toEqual(["lab.write"]);
    expect(selected.status).toBe("READY");
  });

  it("never selects an ARCHIVED agent even if its allowlist matches", async () => {
    const agent = await createAgent({ userId, name: "Archived match", allowedCapabilities: ["decision.create"] });
    await db.agent.update({ where: { id: agent.id }, data: { status: "ARCHIVED" } });
    const selected = await selectOrCreateAgent(userId, ["decision.create"], "Decide something");
    expect(selected.id).not.toBe(agent.id);
  });

  it("MANUAL autonomy mode creates a newly-selected agent with an empty allowlist regardless of what the plan needs", async () => {
    const manualUser = await createTestUser();
    expect(await getAutonomyMode(manualUser.id)).toBe("AUTONOMOUS_APPROVAL_GATES");
    await setAutonomyMode(manualUser.id, "MANUAL");

    const selected = await selectOrCreateAgent(manualUser.id, ["project.write"], "Do something consequential");
    expect(JSON.parse(selected.allowedCapabilities)).toEqual([]);
  });
});

describe("Supervisor: approval boundary (deterministic tool-bound steps)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("reaches WAITING_FOR_APPROVAL and emits approval.required when a step's capability isn't granted, then Approve resumes it to COMPLETED", async () => {
    const objective = await createObjective({ userId, title: "Create a task via approval flow." });
    const agent = await createAgent({ userId, name: "Task agent", allowedCapabilities: ["project.write"] });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, agentId: agent.id, status: "RUNNING" } });

    const agentRun = await buildToolBoundRun(userId, agent.id, supRun.id, "task.create", { title: "Supervisor approval test task" });
    const afterFirst = await applyAgentRunOutcome(userId, supRun.id, agentRun);
    expect(afterFirst.status).toBe("WAITING_FOR_APPROVAL");

    const requiredEvent = await db.event.findFirst({ where: { userId, type: "approval.required", subjectId: supRun.id } });
    expect(requiredEvent).not.toBeNull();

    await grantPermission(userId, "project.write", "RECOMMEND");
    const resumed = await resumeSupervisorRun(userId, supRun.id);
    expect(resumed!.status).toBe("COMPLETED");

    const approvedEvent = await db.event.findFirst({ where: { userId, type: "approval.approved", subjectId: supRun.id } });
    expect(approvedEvent).not.toBeNull();

    const task = await db.task.findFirst({ where: { userId, title: "Supervisor approval test task" } });
    expect(task).not.toBeNull();
  });

  it("Decline cancels the blocked agent run, stops the SupervisorRun, and never performs the action", async () => {
    // A fresh user, deliberately not reusing `userId` — an earlier test in
    // this block already granted project.write to `userId`, which would
    // let this step succeed immediately instead of pausing for approval.
    const declineUser = await createTestUser();
    const objective = await createObjective({ userId: declineUser.id, title: "Create a task, but decline it." });
    const agent = await createAgent({ userId: declineUser.id, name: "Task agent 2", allowedCapabilities: ["project.write"] });
    const supRun = await db.supervisorRun.create({ data: { userId: declineUser.id, objectiveId: objective.id, agentId: agent.id, status: "RUNNING" } });

    const agentRun = await buildToolBoundRun(declineUser.id, agent.id, supRun.id, "task.create", { title: "Should never be created" });
    const waiting = await applyAgentRunOutcome(declineUser.id, supRun.id, agentRun);
    expect(waiting.status).toBe("WAITING_FOR_APPROVAL");

    const declined = await declineSupervisorRun(declineUser.id, supRun.id);
    expect(declined!.status).toBe("CANCELLED");
    expect(declined!.error).toMatch(/declined/i);

    const declinedEvent = await db.event.findFirst({ where: { userId: declineUser.id, type: "approval.declined", subjectId: supRun.id } });
    expect(declinedEvent).not.toBeNull();

    const task = await db.task.findFirst({ where: { userId: declineUser.id, title: "Should never be created" } });
    expect(task).toBeNull();
  });

  it("cancelSupervisorRun stops an in-flight run", async () => {
    const objective = await createObjective({ userId, title: "Cancel me mid-flight." });
    const agent = await createAgent({ userId, name: "Cancel-target agent", allowedCapabilities: [] });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, agentId: agent.id, status: "RUNNING" } });
    await db.agentRun.create({ data: { userId, agentId: agent.id, supervisorRunId: supRun.id, objective: "in flight", status: "RUNNING" } });

    const cancelled = await cancelSupervisorRun(userId, supRun.id);
    expect(cancelled!.status).toBe("CANCELLED");
  });

  it("scopes supervisor runs to their owner", async () => {
    const otherUser = await createTestUser();
    const objective = await createObjective({ userId: otherUser.id, title: "Not yours to resume." });
    const supRun = await db.supervisorRun.create({ data: { userId: otherUser.id, objectiveId: objective.id, status: "WAITING_FOR_APPROVAL" } });
    expect(await resumeSupervisorRun(userId, supRun.id)).toBeNull();
    expect(await declineSupervisorRun(userId, supRun.id)).toBeNull();
    expect(await cancelSupervisorRun(userId, supRun.id)).toBeNull();
  });
});

describe("Supervisor: bounded replanning on failure", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("replans once (within maxIterations) after a failed run, and the retry succeeds via the honest fallback plan", async () => {
    const objective = await createObjective({ userId, title: "Retry after a fake tool failure." });
    const agent = await createAgent({ userId, name: "Retry agent", allowedCapabilities: [] });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, agentId: agent.id, status: "RUNNING", maxIterations: 2 } });

    const failedRun = await buildToolBoundRun(userId, agent.id, supRun.id, "not.a.real.tool", {});
    expect(failedRun.status).toBe("FAILED");

    const outcome = await applyAgentRunOutcome(userId, supRun.id, failedRun);
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.iterations).toBe(1);

    const replanEvent = await db.event.findFirst({ where: { userId, type: "supervisor.replanning", subjectId: supRun.id } });
    expect(replanEvent).not.toBeNull();
  });

  it("gives up honestly once maxIterations is exhausted, without retrying further", async () => {
    const objective = await createObjective({ userId, title: "Exhaust the iteration budget." });
    const agent = await createAgent({ userId, name: "Exhausted agent", allowedCapabilities: [] });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, agentId: agent.id, status: "RUNNING", maxIterations: 0 } });

    const failedRun = await buildToolBoundRun(userId, agent.id, supRun.id, "not.a.real.tool", {});
    const outcome = await applyAgentRunOutcome(userId, supRun.id, failedRun);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.iterations).toBe(0);

    const failedEvent = await db.event.findFirst({ where: { userId, type: "supervisor.failed", subjectId: supRun.id } });
    expect(failedEvent).not.toBeNull();
  });
});

describe("Cross-domain: Objective -> Supervisor -> Agent -> Tool Registry -> real Lab service -> real event bus -> Brain graph", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    await grantPermission(userId, "lab.write", "RECOMMEND");
  });

  it("drives a real lab.create_requirement action and surfaces the SupervisorRun in the Brain graph", async () => {
    const objective = await createObjective({ userId, title: "Investigate an unresolved Lab requirement." });
    const agent = await createAgent({ userId, name: "Lab supervisor agent", allowedCapabilities: ["lab.write"] });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, agentId: agent.id, status: "RUNNING" } });

    const agentRun = await buildToolBoundRun(userId, agent.id, supRun.id, "lab.create_requirement", {
      title: "Cold-weather webbing durability",
      priority: "HIGH",
    });
    const outcome = await applyAgentRunOutcome(userId, supRun.id, agentRun);
    expect(outcome.status).toBe("COMPLETED");

    const requirement = await db.labRequirement.findFirst({ where: { userId, title: "Cold-weather webbing durability" } });
    expect(requirement).not.toBeNull();

    const completedEvent = await db.event.findFirst({ where: { userId, type: "supervisor.completed", subjectId: supRun.id } });
    expect(completedEvent).not.toBeNull();
    const labEvent = await db.event.findFirst({ where: { userId, type: "lab.requirement.created", subjectId: requirement!.id } });
    expect(labEvent).not.toBeNull();

    const graph = await getBrainGraph(userId);
    const supervisorNode = graph.nodes.find((n) => n.type === "SUPERVISOR_RUN" && n.entityId === supRun.id);
    expect(supervisorNode).toBeDefined();
    expect(supervisorNode!.status).toBe("COMPLETED");

    const objectiveEdge = graph.edges.find((e) => e.from === `OBJECTIVE:${objective.id}` && e.to === `SUPERVISOR_RUN:${supRun.id}`);
    expect(objectiveEdge).toBeDefined();

    const drivesEdge = graph.edges.find((e) => e.from === `SUPERVISOR_RUN:${supRun.id}` && e.to === `AGENT_RUN:${agentRun.id}`);
    expect(drivesEdge).toBeDefined();
  });
});
