import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { createMemory } from "@/lib/memory/service";
import { startSupervisorRun } from "@/lib/supervisor/service";
import { buildPlanningContext, renderPlanningContext } from "@/lib/agents/context";
import { createTestUser } from "./helpers";

/**
 * The learning half of the autonomous loop: work that finishes has to leave a
 * durable trace, and the next planning pass has to actually read it back.
 * Before this existed, Outcome rows were written and then consumed by nothing
 * except the Brain visualization, so VOX re-derived every plan from zero.
 */
describe("Planning context: outcomes and memories feed back into planning", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("returns empty context for a cold system without throwing", async () => {
    const context = await buildPlanningContext(userId, "something never attempted before");
    expect(context.memories).toEqual([]);
    expect(context.priorOutcomes).toEqual([]);
    // A cold system must render to nothing, not to empty scaffolding.
    expect(renderPlanningContext(context)).toBe("");
  });

  it("surfaces stored memories relevant to the objective", async () => {
    await createMemory({
      userId,
      content: "The user prefers concise written summaries over long reports.",
      category: "PREFERENCE",
      confidence: "HIGH",
    });

    const context = await buildPlanningContext(userId, "write a summary for the user");
    expect(context.memories.length).toBeGreaterThan(0);

    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("concise written summaries");
    // Confidence must travel with the fact so the planner can weigh it.
    expect(rendered).toContain("HIGH");
  });

  it("records a durable EXPERIENCE memory for a non-economic supervised run", async () => {
    const before = await db.memory.count({ where: { userId } });

    const objective = await createObjective({ userId, title: "Greet the user once." });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const after = await db.memory.count({ where: { userId } });
    expect(after).toBeGreaterThan(before);

    // Previously only opportunity-backed objectives produced a memory at all.
    const outcomeMemory = await db.memory.findFirst({
      where: { userId, provenance: "supervisor:outcome" },
      orderBy: { createdAt: "desc" },
    });
    expect(outcomeMemory).not.toBeNull();
  });

  it("feeds a completed run's real outcome back into the next planning context", async () => {
    const objective = await createObjective({ userId, title: "Draft the quarterly note." });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const outcome = await db.outcome.findFirst({ where: { supervisorRunId: supRun.id } });
    expect(outcome).not.toBeNull();

    // Planning the SAME objective again must see that prior attempt, flagged
    // as this objective's own history rather than generic background.
    const context = await buildPlanningContext(userId, "Draft the quarterly note.", { objectiveId: objective.id });
    const own = context.priorOutcomes.filter((o) => o.sameObjective);
    expect(own.length).toBeGreaterThan(0);
    expect(own[0].objectiveTitle).toBe("Draft the quarterly note.");

    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("THIS objective");
    expect(rendered).toContain("previous attempts actually turned out");
  });

  it("orders this objective's own history ahead of unrelated history", async () => {
    const target = await createObjective({ userId, title: "Reconcile the ledger." });
    await startSupervisorRun({ userId, objectiveId: target.id });
    // A newer, unrelated run — recency alone would rank this first.
    const other = await createObjective({ userId, title: "Unrelated later work." });
    await startSupervisorRun({ userId, objectiveId: other.id });

    const context = await buildPlanningContext(userId, "Reconcile the ledger.", { objectiveId: target.id });
    expect(context.priorOutcomes.length).toBeGreaterThan(1);
    expect(context.priorOutcomes[0].sameObjective).toBe(true);
    expect(context.priorOutcomes[0].objectiveTitle).toBe("Reconcile the ledger.");
  });

  it("never fabricates outcome context for a different user", async () => {
    const stranger = await createTestUser();
    const context = await buildPlanningContext(stranger.id, "Reconcile the ledger.");
    expect(context.priorOutcomes).toEqual([]);
    expect(context.memories).toEqual([]);
  });
});
