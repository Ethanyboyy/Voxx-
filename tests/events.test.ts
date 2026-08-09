import { describe, it, expect, beforeAll } from "vitest";
import { recordEvent, listRecentEvents } from "@/lib/observability/events";
import { createProject, updateProject, createTask, updateTask, createGoal, updateGoal, createDecision, updateDecision, createExperiment, addExperimentResult } from "@/lib/projects/service";
import { createTestUser } from "./helpers";

describe("durable event timeline", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("records subjectType/subjectId as descriptive-only fields (survive subject deletion)", async () => {
    const event = await recordEvent({
      userId,
      type: "test.event",
      subjectType: "Task",
      subjectId: "some-deleted-task-id",
    });
    expect(event.subjectType).toBe("Task");
    expect(event.subjectId).toBe("some-deleted-task-id");
  });

  it("listRecentEvents can filter by subjectType and subjectId", async () => {
    await recordEvent({ userId, type: "test.a", subjectType: "Widget", subjectId: "w1" });
    await recordEvent({ userId, type: "test.b", subjectType: "Widget", subjectId: "w2" });
    await recordEvent({ userId, type: "test.c", subjectType: "Gadget", subjectId: "w1" });

    const widgetEvents = await listRecentEvents(userId, { subjectType: "Widget" });
    expect(widgetEvents.every((e) => e.subjectType === "Widget")).toBe(true);
    expect(widgetEvents.length).toBeGreaterThanOrEqual(2);

    const w1Events = await listRecentEvents(userId, { subjectType: "Widget", subjectId: "w1" });
    expect(w1Events.every((e) => e.subjectId === "w1" && e.subjectType === "Widget")).toBe(true);
  });

  it("task completion records a task.completed event exactly once per transition", async () => {
    const task = await createTask({ userId, title: "Finish the report" });
    await updateTask(userId, task.id, { status: "DONE" });
    await updateTask(userId, task.id, { status: "DONE" }); // no-op transition, should not double-record

    const events = await listRecentEvents(userId, { subjectType: "Task", subjectId: task.id });
    const completions = events.filter((e) => e.type === "task.completed");
    expect(completions).toHaveLength(1);
  });

  it("a project reaching COMPLETED records project.milestone, not just a generic status change", async () => {
    const project = await createProject({ userId, name: "Milestone project" });
    await updateProject(userId, project.id, { status: "COMPLETED" });

    const events = await listRecentEvents(userId, { subjectType: "Project", subjectId: project.id });
    expect(events.some((e) => e.type === "project.milestone")).toBe(true);
  });

  it("a project pausing records a generic status change, not a milestone", async () => {
    const project = await createProject({ userId, name: "Pause project" });
    await updateProject(userId, project.id, { status: "PAUSED" });

    const events = await listRecentEvents(userId, { subjectType: "Project", subjectId: project.id });
    expect(events.some((e) => e.type === "project.status_changed")).toBe(true);
    expect(events.some((e) => e.type === "project.milestone")).toBe(false);
  });

  it("goal status changes are recorded", async () => {
    const goal = await createGoal({ userId, title: "Grow revenue" });
    await updateGoal(userId, goal.id, { status: "ACHIEVED" });

    const events = await listRecentEvents(userId, { subjectType: "Goal", subjectId: goal.id });
    expect(events.some((e) => e.type === "goal.status_changed")).toBe(true);
  });

  it("a decision becoming DECIDED records decision.made", async () => {
    const decision = await createDecision({ userId, title: "Pricing model" });
    await updateDecision(userId, decision.id, { status: "DECIDED", chosenOption: "subscription" });

    const events = await listRecentEvents(userId, { subjectType: "Decision", subjectId: decision.id });
    expect(events.some((e) => e.type === "decision.made")).toBe(true);
  });

  it("recording an experiment result records experiment.result_recorded", async () => {
    const experiment = await createExperiment({ userId, hypothesis: "Loyalty program increases retention" });
    await addExperimentResult(userId, { experimentId: experiment.id, outcome: "Retention rose 8%" });

    const events = await listRecentEvents(userId, { subjectType: "Experiment", subjectId: experiment.id });
    expect(events.some((e) => e.type === "experiment.result_recorded")).toBe(true);
  });
});
