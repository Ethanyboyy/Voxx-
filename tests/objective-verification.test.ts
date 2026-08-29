import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective, getObjective } from "@/lib/objectives/service";
import { startSupervisorRun, applyAgentRunOutcome } from "@/lib/supervisor/service";
import { buildPlanningContext, renderPlanningContext } from "@/lib/agents/context";
import { getNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { aggregateStatus, collectEvidence, parseSuccessCriteria, verifyObjective } from "@/lib/objectives/verification";
import { executeRun } from "@/lib/agents/executor";
import { createTestUser } from "./helpers";
import type { AgentRun, AgentStep, Objective } from "@/generated/prisma/client";

/**
 * Verification answers "was the OBJECTIVE achieved?", which is a strictly
 * stronger claim than "did execution finish". The tests that matter most here
 * are the ones proving VOX refuses to claim success it cannot demonstrate.
 */
describe("Verification: aggregation is conservative by construction", () => {
  const c = (criterion: string, met: boolean | null) => ({ criterion, met, reasoning: "" });

  it("requires every criterion to be demonstrated before reporting ACHIEVED", () => {
    expect(aggregateStatus([c("a", true), c("b", true)])).toBe("ACHIEVED");
    // One undeterminable criterion is enough to block ACHIEVED.
    expect(aggregateStatus([c("a", true), c("b", null)])).toBe("PARTIALLY_ACHIEVED");
  });

  it("reports UNVERIFIED — not FAILED — when nothing was met but something was uncheckable", () => {
    // Claiming failure would assert knowledge the evidence does not support.
    expect(aggregateStatus([c("a", null)])).toBe("UNVERIFIED");
    expect(aggregateStatus([c("a", false), c("b", null)])).toBe("UNVERIFIED");
  });

  it("reports FAILED only when every criterion was positively checked and unmet", () => {
    expect(aggregateStatus([c("a", false), c("b", false)])).toBe("FAILED");
  });

  it("treats mixed met/unmet as partial", () => {
    expect(aggregateStatus([c("a", true), c("b", false)])).toBe("PARTIALLY_ACHIEVED");
  });

  it("has nothing to say without criteria", () => {
    expect(aggregateStatus([])).toBe("UNVERIFIED");
  });
});

describe("Verification: criteria parsing and evidence collection", () => {
  it("parses stored criteria and tolerates malformed values", () => {
    expect(parseSuccessCriteria(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
    expect(parseSuccessCriteria(null)).toEqual([]);
    expect(parseSuccessCriteria("not json")).toEqual([]);
    // Non-strings and blanks are dropped rather than becoming criteria.
    expect(parseSuccessCriteria(JSON.stringify(["ok", 5, "  "]))).toEqual(["ok"]);
  });

  it("collects only real recorded facts, and says so when a target has no reported value", () => {
    const objective = { targetValue: 500, targetUnit: "USD", currentValue: null } as Objective;
    const run = {
      status: "COMPLETED",
      error: null,
      steps: [
        { order: 0, description: "make a thing", toolName: "memory.create", status: "COMPLETED", output: '{"id":"m1"}', error: null },
        { order: 1, description: "second", toolName: "task.create", status: "FAILED", output: null, error: "boom" },
      ] as AgentStep[],
    } as AgentRun & { steps: AgentStep[] };

    const evidence = collectEvidence(objective, run);
    expect(evidence.some((e) => e.type === "step:memory.create")).toBe(true);
    expect(evidence.some((e) => e.type === "step-failed:task.create")).toBe(true);
    // currentValue is never inferred, so an absent one must be stated as absent.
    const target = evidence.find((e) => e.type === "objective.target");
    expect(target!.text).toContain("no actual value has been reported");
  });
});

describe("Verification: end-to-end honesty", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("returns UNVERIFIED when the objective never defined what success means", async () => {
    const objective = await createObjective({ userId, title: "No criteria defined." });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const outcome = await db.outcome.findFirst({ where: { supervisorRunId: supRun.id } });
    // Execution completed, but the objective's success is unknown — the two
    // must not be conflated.
    expect(outcome!.status).toBe("COMPLETED");
    expect(outcome!.verification).toBe("UNVERIFIED");
    expect(outcome!.summary).toMatch(/not.*independently verified/i);
  });

  it("never reports ACHIEVED from execution merely finishing", async () => {
    const objective = await createObjective({
      userId,
      title: "Publish a real listing.",
      successCriteria: ["A listing exists and is publicly published", "It has at least 3 photos"],
    });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const outcome = await db.outcome.findFirst({ where: { supervisorRunId: supRun.id } });
    // The mock provider cannot judge the evidence, so the only honest answer
    // is UNVERIFIED — under no circumstances ACHIEVED.
    expect(outcome!.verification).not.toBe("ACHIEVED");
    expect(outcome!.verification).toBe("UNVERIFIED");
    // The criteria we judged against are recorded for audit.
    expect(outcome!.expectedResult).toContain("publicly published");
  });

  it("reports FAILED against criteria when the run genuinely failed", async () => {
    const objective = await createObjective({
      userId,
      title: "Objective that cannot succeed.",
      successCriteria: ["The impossible thing happened"],
    });
    const supRun = await db.supervisorRun.create({
      data: { userId, objectiveId: objective.id, status: "RUNNING", maxIterations: 0 },
    });
    const run = await db.agentRun.create({
      data: { userId, supervisorRunId: supRun.id, objective: objective.title, status: "PLANNING" },
    });
    await db.agentStep.create({
      data: { runId: run.id, order: 0, description: "boom", toolName: "not.a.real.tool", requiredLevel: "OBSERVE" },
    });
    const failed = await executeRun(userId, run.id);
    await applyAgentRunOutcome(userId, supRun.id, failed);

    const outcome = await db.outcome.findFirst({ where: { supervisorRunId: supRun.id } });
    expect(outcome!.status).toBe("FAILED");
    expect(outcome!.verification).toBe("FAILED");
    // A failed run is checked from the real record, not by asking a model.
    expect(outcome!.variance).toContain("not met");
  });

  it("verifies directly against a failed run without needing a model", async () => {
    const objective = {
      id: "o1",
      title: "t",
      successCriteria: JSON.stringify(["Something specific"]),
      targetValue: null,
      targetUnit: null,
      currentValue: null,
    } as Objective;
    const run = {
      status: "FAILED",
      error: "the tool exploded",
      steps: [{ order: 0, description: "s", toolName: "x", status: "FAILED", output: null, error: "the tool exploded" } as AgentStep],
    } as AgentRun & { steps: AgentStep[] };

    const result = await verifyObjective(objective, run);
    expect(result.status).toBe("FAILED");
    expect(result.confidence).toBe("HIGH");
    expect(result.summary).toContain("the tool exploded");
  });
});

describe("Verification: the full loop feeds learning", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("carries the verdict into memory, the graph, and the next planning context", async () => {
    const objective = await createObjective({
      userId,
      title: "Ship the onboarding flow.",
      successCriteria: ["The onboarding flow is live for real users"],
    });

    // Objective -> criteria -> context-aware plan -> execution -> outcome.
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const outcome = await db.outcome.findFirst({ where: { supervisorRunId: supRun.id } });
    expect(outcome!.verification).toBe("UNVERIFIED");

    // -> learning: the verdict is in the durable EXPERIENCE memory.
    const memory = await db.memory.findFirst({
      where: { userId, provenance: "supervisor:outcome" },
      orderBy: { createdAt: "desc" },
    });
    expect(memory).not.toBeNull();

    // -> graph write-back: the edge records the objective-level verdict.
    const objectiveNode = await getNodeForEntity(userId, "OBJECTIVE", objective.id);
    expect(objectiveNode).not.toBeNull();
    const related = await findRelated(userId, objectiveNode!.id, 1);
    expect(related.some((r) => r.relation === "verified:unverified")).toBe(true);

    // -> future planning can see the previous attempt AND that it was not
    // demonstrably successful.
    const context = await buildPlanningContext(userId, objective.title, { objectiveId: objective.id });
    const own = context.priorOutcomes.filter((o) => o.sameObjective);
    expect(own.length).toBeGreaterThan(0);
    expect(own[0].verification).toBe("UNVERIFIED");

    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("objective UNVERIFIED");
    // The planner is told explicitly not to read "completed" as "worked".
    expect(rendered).toContain("did not demonstrably work");
  });

  it("round-trips success criteria through the objective service", async () => {
    const objective = await createObjective({
      userId,
      title: "Criteria round trip.",
      successCriteria: ["First thing", "Second thing"],
    });
    const loaded = await getObjective(userId, objective.id);
    expect(loaded!.successCriteria).toEqual(["First thing", "Second thing"]);
  });
});
