import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  createObjective,
  createOpportunity,
  updateOpportunity,
  createValidationObjective,
  scoreOpportunity,
  explainOpportunityScore,
  type OpportunityDTO,
} from "@/lib/objectives/service";
import { evaluateSpendPolicy } from "@/lib/economic/policy";
import { getBudgetSummary, recordOpportunitySpend } from "@/lib/economic/service";
import { grantPermission } from "@/lib/permissions/service";
import { startSupervisorRun, beginSupervisorExecution, setAutonomyMode, getAutonomyMode } from "@/lib/supervisor/service";
import { getBrainGraph } from "@/lib/brain/graph";
import { createTestUser, approveAndResume } from "./helpers";
import type { AgentRun, AgentStep } from "@/generated/prisma/client";

function baseOpportunity(overrides: Partial<OpportunityDTO> = {}): OpportunityDTO {
  return {
    id: "opp1",
    userId: "u1",
    objectiveId: "obj1",
    title: "Test opportunity",
    description: null,
    estimatedValue: 1000,
    effort: "MEDIUM",
    confidence: "MEDIUM",
    risk: "MEDIUM",
    nextAction: null,
    evidence: [],
    status: "IDEA",
    projectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: null,
    source: null,
    discoveredAt: new Date(),
    estimatedStartupCost: null,
    estimatedOperatingCost: null,
    estimatedMargin: null,
    estimatedTimeToRevenueDays: null,
    complexity: null,
    competition: null,
    scalability: null,
    requiredHumanInvolvement: null,
    requiredCapabilities: [],
    dependencies: [],
    rationale: null,
    ...overrides,
  };
}

describe("Economic Engine: opportunity scoring", () => {
  it("Economic Engine factors default to neutral when unset — score matches the pre-Economic-Engine formula", () => {
    const withoutFields = baseOpportunity();
    const legacyScore = (1000 / 2) * 0.75 * (1 - 0.15); // value/effortWeight * confidenceWeight * (1-riskPenalty)
    expect(scoreOpportunity(withoutFields)).toBeCloseTo(legacyScore, 6);
  });

  it("higher startup cost lowers the score (capital drag)", () => {
    const cheap = baseOpportunity({ estimatedStartupCost: 0 });
    const expensive = baseOpportunity({ estimatedStartupCost: 5000 });
    expect(scoreOpportunity(expensive)).toBeLessThan(scoreOpportunity(cheap));
  });

  it("higher margin increases the score", () => {
    const lowMargin = baseOpportunity({ estimatedMargin: 0.1 });
    const highMargin = baseOpportunity({ estimatedMargin: 0.9 });
    expect(scoreOpportunity(highMargin)).toBeGreaterThan(scoreOpportunity(lowMargin));
  });

  it("faster time-to-revenue increases the score", () => {
    const slow = baseOpportunity({ estimatedTimeToRevenueDays: 180 });
    const fast = baseOpportunity({ estimatedTimeToRevenueDays: 7 });
    expect(scoreOpportunity(fast)).toBeGreaterThan(scoreOpportunity(slow));
  });

  it("HIGH scalability is a bonus, HIGH complexity/competition/human-involvement are penalties", () => {
    const plain = baseOpportunity();
    const scalable = baseOpportunity({ scalability: "HIGH" });
    const complex = baseOpportunity({ complexity: "HIGH" });
    expect(scoreOpportunity(scalable)).toBeGreaterThan(scoreOpportunity(plain));
    expect(scoreOpportunity(complex)).toBeLessThan(scoreOpportunity(plain));
  });

  it("explainOpportunityScore never recomputes a different number than scoreOpportunity", () => {
    const o = baseOpportunity({ estimatedStartupCost: 2000, estimatedMargin: 0.4, scalability: "HIGH" });
    expect(explainOpportunityScore(o).score).toBe(scoreOpportunity(o));
  });
});

describe("Economic Engine: opportunity pipeline + Opportunity -> Objective bridge", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("moves through pipeline statuses via updateOpportunity", async () => {
    const objective = await createObjective({ userId, title: "Parent objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Pipeline test" });
    expect(opportunity!.status).toBe("IDEA");

    const researching = await updateOpportunity(userId, opportunity!.id, { status: "RESEARCHING" });
    expect(researching!.status).toBe("RESEARCHING");
    const event = await db.event.findFirst({ where: { userId, type: "opportunity.status_changed", subjectId: opportunity!.id } });
    expect(event).not.toBeNull();
  });

  it("createValidationObjective creates a real Objective linked back to the Opportunity and advances its pipeline status", async () => {
    const objective = await createObjective({ userId, title: "Parent objective 2" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Local lead-generation service" });

    const result = await createValidationObjective({ userId, opportunityId: opportunity!.id });
    expect(result).not.toBeNull();
    expect(result!.objective.title).toContain("Local lead-generation service");
    expect(result!.objective.sourceOpportunityId).toBe(opportunity!.id);
    expect(result!.opportunity.status).toBe("PLANNING");

    const reloaded = await db.objective.findUniqueOrThrow({ where: { id: result!.objective.id } });
    expect(reloaded.sourceOpportunityId).toBe(opportunity!.id);
  });

  it("returns null for an opportunity that doesn't belong to the user", async () => {
    const otherUser = await createTestUser();
    const objective = await createObjective({ userId: otherUser.id, title: "Not yours" });
    const opportunity = await createOpportunity({ userId: otherUser.id, objectiveId: objective.id, title: "Not yours either" });
    expect(await createValidationObjective({ userId, opportunityId: opportunity!.id })).toBeNull();
  });
});

describe("Economic Engine: budget policy", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("defaults maxAutonomousSpendUsd to 0 — no autonomous spend allowed until configured", async () => {
    const decision = await evaluateSpendPolicy(userId, 1);
    expect(decision.allowed).toBe(false);
    expect(decision.thresholdUsd).toBe(0);
  });

  it("allows spend at or under the configured threshold, rejects spend over it", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 50 } });
    expect((await evaluateSpendPolicy(userId, 50)).allowed).toBe(true);
    expect((await evaluateSpendPolicy(userId, 50.01)).allowed).toBe(false);
  });

  it("getBudgetSummary reflects real recorded expenses, never a projection", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
    const objective = await createObjective({ userId, title: "Budget test objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Budget test opportunity" });

    const before = await getBudgetSummary(userId);
    expect(before.totalSpentUsd).toBe(0);

    await recordOpportunitySpend(userId, { opportunityId: opportunity!.id, amountUsd: 17.5, category: "testing" });
    const after = await getBudgetSummary(userId);
    expect(after.totalSpentUsd).toBe(17.5);
    expect(after.remainingAutonomousUsd).toBe(82.5);
  });
});

describe("Economic Engine: security — economic.record_expense requires BOTH capability and budget headroom", () => {
  let userId: string;
  let opportunityId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const objective = await createObjective({ userId, title: "Security test objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Security test opportunity" });
    opportunityId = opportunity!.id;
  });

  async function runSpendStep(amountUsd: number): Promise<AgentRun & { steps: AgentStep[] }> {
    const run = await db.agentRun.create({ data: { userId, objective: "spend test", status: "PLANNING" } });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Record a spend",
        toolName: "economic.record_expense",
        input: JSON.stringify({ opportunityId, amountUsd }),
        requiredLevel: "ACT",
      },
    });
    const { executeRun } = await import("@/lib/agents/executor");
    const first = await executeRun(userId, run.id);
    // [P4-C3] economic.record_expense is FINANCIAL, so the policy gate holds it
    // and it no longer executes without a human's approval. These tests are
    // about the BUDGET CEILING, which is a second and independent guard, so the
    // approval is supplied here through the real endpoint's own service — see
    // `approveAndResume`. The tests below still prove the ceiling stops a spend
    // that a human explicitly approved, which is the stronger claim.
    if (first.status !== "WAITING_FOR_PERMISSION") return first;
    return approveAndResume(userId, run.id);
  }

  it("without the economic.spend capability granted, the run pauses at WAITING_FOR_PERMISSION — no expense is recorded", async () => {
    const result = await runSpendStep(10);
    expect(result.status).toBe("WAITING_FOR_PERMISSION");
    const expenseCount = await db.economicExpense.count({ where: { asset: { opportunityId } } });
    expect(expenseCount).toBe(0);
  });

  it("with the capability granted but the amount over budget, the tool refuses and the run FAILS — no expense is recorded", async () => {
    await grantPermission(userId, "economic.spend", "ACT");
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 5 } });

    const result = await runSpendStep(50);
    expect(result.status).toBe("FAILED");
    // The refusal now names cumulative spend against the ceiling rather than
    // comparing one amount to it — see the regression below for why that
    // distinction is the whole point.
    expect(result.error).toMatch(/above the ceiling/i);
    const expenseCount = await db.economicExpense.count({ where: { asset: { opportunityId } } });
    expect(expenseCount).toBe(0);
  });

  it("with capability granted AND within budget, the run completes and a real expense is recorded", async () => {
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
    const result = await runSpendStep(12.34);
    expect(result.status).toBe("COMPLETED");
    const expense = await db.economicExpense.findFirst({ where: { asset: { opportunityId } } });
    expect(expense).not.toBeNull();
    expect(expense!.amountUsd).toBe(12.34);
  });

  it("REGRESSION: repeated under-ceiling spends through the tool cannot walk past the ceiling", async () => {
    // This test did not exist, and its absence is why the defect survived: every
    // spend here is individually within the $100 ceiling, and the old policy
    // check compared only the single amount, so all three used to succeed and
    // the account spent $180 against a $100 limit.
    // Ordered last, and starts from a clean ledger: this describe block shares
    // one user via beforeAll, so a test that leaves spend behind changes what
    // the tests after it measure.
    await db.economicExpense.deleteMany({ where: { asset: { opportunityId } } });
    await grantPermission(userId, "economic.spend", "ACT");
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });

    expect((await runSpendStep(60)).status).toBe("COMPLETED");
    expect((await runSpendStep(60)).status).toBe("FAILED");
    expect((await runSpendStep(60)).status).toBe("FAILED");

    const spend = await db.economicExpense.aggregate({
      where: { asset: { opportunityId } },
      _sum: { amountCents: true },
    });
    expect(spend._sum.amountCents).toBe(6000);
  });
});

describe("Economic Engine: MANUAL autonomy stops at BLOCKED before executing", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("startSupervisorRun under MANUAL plans and selects an agent but does not start any AgentRun", async () => {
    expect(await getAutonomyMode(userId)).toBe("AUTONOMOUS_APPROVAL_GATES");
    await setAutonomyMode(userId, "MANUAL");

    const objective = await createObjective({ userId, title: "Manual mode objective" });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });

    expect(supRun.status).toBe("BLOCKED");
    expect(supRun.plan).not.toBeNull();
    expect(supRun.agentId).not.toBeNull();
    expect(supRun.agentRuns.length).toBe(0);

    const blockedEvent = await db.event.findFirst({ where: { userId, type: "supervisor.blocked", subjectId: supRun.id } });
    expect(blockedEvent).not.toBeNull();
  });

  it("beginSupervisorExecution runs exactly the stored plan and reaches a terminal state", async () => {
    const objective = await createObjective({ userId, title: "Manual mode objective 2" });
    const blocked = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(blocked.status).toBe("BLOCKED");

    const started = await beginSupervisorExecution(userId, blocked.id);
    expect(started).not.toBeNull();
    expect(["COMPLETED", "WAITING_FOR_APPROVAL", "FAILED"]).toContain(started!.status);
    expect(started!.agentRuns.length).toBeGreaterThan(0);
  });

  it("scopes to the owner and no-ops when the run isn't BLOCKED", async () => {
    const otherUser = await createTestUser();
    expect(await beginSupervisorExecution(userId, "nonexistent-id")).toBeNull();

    await setAutonomyMode(otherUser.id, "AUTONOMOUS_APPROVAL_GATES");
    const objective = await createObjective({ userId: otherUser.id, title: "Not manual" });
    const run = await startSupervisorRun({ userId: otherUser.id, objectiveId: objective.id });
    expect(run.status).not.toBe("BLOCKED");
    const noop = await beginSupervisorExecution(otherUser.id, run.id);
    expect(noop!.status).toBe(run.status);
  });
});

describe("Economic Engine: honest Outcome recording", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("records an honest COMPLETED outcome that does not claim the objective's real-world goal succeeded", async () => {
    const objective = await createObjective({ userId, title: "Outcome honesty test" });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const outcome = await db.outcome.findUnique({ where: { supervisorRunId: supRun.id } });
    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe("COMPLETED");
    expect(outcome!.summary).toMatch(/not.*independently verified/i);
  });

  it("writes an outcome memory for every objective, but only opportunity-sourced ones get economic provenance", async () => {
    const plainObjective = await createObjective({ userId, title: "Plain objective, not opportunity-sourced" });
    const opportunityObjectiveSeed = await createObjective({ userId, title: "Opp parent" });
    const opportunity = await createOpportunity({ userId, objectiveId: opportunityObjectiveSeed.id, title: "Memory test opportunity" });
    const validation = await createValidationObjective({ userId, opportunityId: opportunity!.id });

    // Force both objectives to fail via an unknown-tool step, bypassing the mock planner.
    for (const objective of [plainObjective, validation!.objective]) {
      const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, status: "RUNNING", maxIterations: 0 } });
      const run = await db.agentRun.create({ data: { userId, supervisorRunId: supRun.id, objective: objective.title, status: "PLANNING" } });
      await db.agentStep.create({ data: { runId: run.id, order: 0, description: "boom", toolName: "not.a.real.tool", requiredLevel: "OBSERVE" } });
      const { executeRun } = await import("@/lib/agents/executor");
      const { applyAgentRunOutcome } = await import("@/lib/supervisor/service");
      const failedRun = await executeRun(userId, run.id);
      await applyAgentRunOutcome(userId, supRun.id, failedRun);
    }

    // Every supervised run now leaves a durable EXPERIENCE memory so the
    // planner can learn from it (src/lib/agents/context.ts). What stays
    // economic-specific is the PROVENANCE — asserted directly here rather
    // than inferred from a total count, which previously only distinguished
    // the two cases because plain objectives recorded nothing at all.
    const economic = await db.memory.findMany({ where: { userId, provenance: "supervisor:economic-outcome" } });
    expect(economic.length).toBe(1);

    const plain = await db.memory.findMany({ where: { userId, provenance: "supervisor:outcome" } });
    expect(plain.length).toBeGreaterThan(0);
  });
});

describe("Cross-domain: Opportunity -> Objective -> SupervisorRun -> AgentRun -> economic.record_expense -> real Outcome -> Brain graph", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    await grantPermission(userId, "economic.spend", "ACT");
    await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: 100 } });
  });

  it("drives a real spend through the full pipeline and surfaces it in the Brain graph", async () => {
    const objective = await createObjective({ userId, title: "Cross-domain economic objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Cross-domain opportunity" });
    const validation = await createValidationObjective({ userId, opportunityId: opportunity!.id });

    const agent = await db.agent.create({ data: { userId, name: "Cross-domain agent", status: "READY", allowedCapabilities: JSON.stringify(["economic.spend"]) } });
    const supRun = await db.supervisorRun.create({ data: { userId, objectiveId: validation!.objective.id, agentId: agent.id, status: "RUNNING" } });
    const run = await db.agentRun.create({ data: { userId, agentId: agent.id, supervisorRunId: supRun.id, objective: validation!.objective.title, status: "PLANNING" } });
    await db.agentStep.create({
      data: {
        runId: run.id,
        order: 0,
        description: "Spend on initial validation",
        toolName: "economic.record_expense",
        input: JSON.stringify({ opportunityId: opportunity!.id, amountUsd: 25 }),
        requiredLevel: "ACT",
      },
    });

    const { executeRun } = await import("@/lib/agents/executor");
    const { applyAgentRunOutcome } = await import("@/lib/supervisor/service");
    const parked = await executeRun(userId, run.id);
    // [P4-C3] The spend step is FINANCIAL, so it holds for a human before it
    // reaches the ledger. This pipeline test is about what happens AFTER the
    // spend, so the approval is supplied through the real service.
    expect(parked.status).toBe("WAITING_FOR_PERMISSION");
    const executed = await approveAndResume(userId, run.id);
    expect(executed.status).toBe("COMPLETED");
    const outcome = await applyAgentRunOutcome(userId, supRun.id, executed);
    expect(outcome.status).toBe("COMPLETED");

    const dbOutcome = await db.outcome.findUnique({ where: { supervisorRunId: supRun.id } });
    expect(dbOutcome!.costUsd).toBe(25);

    const graph = await getBrainGraph(userId);
    const assetNode = graph.nodes.find((n) => n.type === "ECONOMIC_ASSET" && (n.meta as { opportunityId?: string }).opportunityId === opportunity!.id);
    expect(assetNode).toBeDefined();

    const promotedEdge = graph.edges.find((e) => e.from === `OPPORTUNITY:${opportunity!.id}` && e.relation === "promoted_to_asset");
    expect(promotedEdge).toBeDefined();

    const validationEdge = graph.edges.find(
      (e) => e.from === `OPPORTUNITY:${opportunity!.id}` && e.to === `OBJECTIVE:${validation!.objective.id}` && e.relation === "prompted_validation_of"
    );
    expect(validationEdge).toBeDefined();

    const supervisorNode = graph.nodes.find((n) => n.type === "SUPERVISOR_RUN" && n.entityId === supRun.id);
    expect(supervisorNode).toBeDefined();
    expect((supervisorNode!.meta as { outcome?: { costUsd?: number } }).outcome?.costUsd).toBe(25);
  });
});
