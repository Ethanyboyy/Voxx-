import { describe, it, expect, beforeAll } from "vitest";
import {
  createProject,
  listProjects,
  updateProject,
  deleteProject,
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  createGoal,
  createDecision,
  createIdea,
  createExperiment,
  addExperimentResult,
} from "@/lib/projects/service";
import { createTestUser } from "./helpers";

describe("projects, goals, tasks", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates a project with sensible defaults", async () => {
    const project = await createProject({ userId, name: "Pokemon Shop" });
    expect(project.status).toBe("ACTIVE");
    expect(project.name).toBe("Pokemon Shop");
  });

  it("lists only the owning user's projects and supports status filtering", async () => {
    const otherUser = await createTestUser();
    await createProject({ userId: otherUser.id, name: "Not mine" });
    await createProject({ userId, name: "Archived project", status: "ARCHIVED" });

    const all = await listProjects(userId);
    expect(all.some((p) => p.name === "Not mine")).toBe(false);

    const active = await listProjects(userId, "ACTIVE");
    expect(active.every((p) => p.status === "ACTIVE")).toBe(true);
  });

  it("updates and deletes a project scoped to its owner", async () => {
    const project = await createProject({ userId, name: "Temp project" });
    const updated = await updateProject(userId, project.id, { status: "COMPLETED" });
    expect(updated?.status).toBe("COMPLETED");

    const otherUser = await createTestUser();
    expect(await updateProject(otherUser.id, project.id, { status: "ARCHIVED" })).toBeNull();

    expect(await deleteProject(userId, project.id)).toBe(true);
    expect(await deleteProject(userId, project.id)).toBe(false);
  });

  it("creates a task with default status/priority and lists it", async () => {
    const project = await createProject({ userId, name: "Task project" });
    const task = await createTask({ userId, projectId: project.id, title: "Ship v1" });
    expect(task.status).toBe("TODO");
    expect(task.priority).toBe("MEDIUM");

    const tasks = await listTasks(userId, project.id);
    expect(tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it("marking a task DONE sets completedAt, and moving it off DONE clears it", async () => {
    const task = await createTask({ userId, title: "Track completion" });
    const done = await updateTask(userId, task.id, { status: "DONE" });
    expect(done?.completedAt).toBeInstanceOf(Date);

    const reopened = await updateTask(userId, task.id, { status: "TODO" });
    expect(reopened?.completedAt).toBeNull();
  });

  it("deletes a task and reports false for a non-existent one", async () => {
    const task = await createTask({ userId, title: "Delete me" });
    expect(await deleteTask(userId, task.id)).toBe(true);
    expect(await deleteTask(userId, task.id)).toBe(false);
  });

  it("supports goals, decisions, ideas and experiments with results", async () => {
    const project = await createProject({ userId, name: "Full lifecycle project" });

    const goal = await createGoal({ userId, projectId: project.id, title: "Grow revenue" });
    expect(goal.status).toBe("ACTIVE");

    const decision = await createDecision({
      userId,
      projectId: project.id,
      title: "Pricing model",
      alternatives: ["subscription", "one-time"],
    });
    expect(decision.status).toBe("PENDING");
    expect(JSON.parse(decision.alternatives ?? "[]")).toEqual(["subscription", "one-time"]);

    const idea = await createIdea({ userId, projectId: project.id, title: "Loyalty program" });
    expect(idea.status).toBe("CAPTURED");

    const experiment = await createExperiment({
      userId,
      projectId: project.id,
      ideaId: idea.id,
      hypothesis: "A loyalty program increases repeat purchases",
    });
    expect(experiment.status).toBe("PLANNED");

    const result = await addExperimentResult(userId, {
      experimentId: experiment.id,
      outcome: "Repeat purchase rate rose 12%",
      confidence: "MEDIUM",
    });
    expect(result?.outcome).toBe("Repeat purchase rate rose 12%");

    const otherUser = await createTestUser();
    expect(await addExperimentResult(otherUser.id, { experimentId: experiment.id, outcome: "hijack" })).toBeNull();
  });
});
