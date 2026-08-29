import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { runResearch } from "@/lib/research/service";
import { createExperiment, addExperimentResult, nextExperimentCode } from "@/lib/lab/experiments";
import { createSimulation, executeSimulation } from "@/lib/lab/simulations";
import { getObjectiveEvidence } from "@/lib/objectives/evidence";
import { createTestUser } from "./helpers";

/**
 * The user-facing read of the evidence linkage. It must agree with what the
 * planner sees — a dossier that disagreed with the planning context would be
 * worse than no dossier, because the user would be reasoning from a
 * different set of facts than VOX.
 */

describe("Objective evidence dossier", () => {
  let userId: string;
  let objectiveId: string;
  let otherObjectiveId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    objectiveId = (await createObjective({ userId, title: "Dossier objective." })).id;
    otherObjectiveId = (await createObjective({ userId, title: "Unrelated objective." })).id;

    await runResearch(userId, "dossier research query", { objectiveId });

    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: "Dossier experiment",
      hypothesis: "Something measurable happens.",
      objectiveId,
    });
    await addExperimentResult(userId, experiment.id, { outcome: "It happened.", confidence: "ESTIMATED" });

    const scenario = await db.labScenario.create({
      data: {
        name: "Dossier scenario",
        environment: "ROOFTOP",
        objectiveType: "TIMED_TRAVERSAL",
        difficulty: "INTERMEDIATE",
        gravityMs2: 9.81,
      },
    });
    const simulation = await createSimulation({ userId, name: "Dossier sim", scenarioId: scenario.id, objectiveId });
    await executeSimulation(userId, simulation.id, 99);
  });

  it("returns every grade of evidence, each labelled with what it actually is", async () => {
    const evidence = await getObjectiveEvidence(userId, objectiveId);

    expect(evidence.counts.research).toBeGreaterThan(0);
    expect(evidence.counts.experiment).toBeGreaterThan(0);
    expect(evidence.counts.simulation).toBeGreaterThan(0);

    const simulated = evidence.items.find((i) => i.kind === "simulation");
    expect(simulated).toBeDefined();
    // The flag is derived from provenance, not from the edge, so a bad edge
    // can never let a model output through unmarked.
    expect(simulated!.simulated).toBe(true);
    expect(simulated!.confidence).toBe("LOW");
    expect(simulated!.content.startsWith("SIMULATED RESULT — not a physical measurement.")).toBe(true);

    // Non-simulation evidence must not be flagged as simulated.
    expect(evidence.items.filter((i) => i.kind !== "simulation").every((i) => i.simulated === false)).toBe(true);
  });

  it("counts the real work done for the objective straight from the source tables", async () => {
    const evidence = await getObjectiveEvidence(userId, objectiveId);
    // Independent of the best-effort graph write, so the page can be honest
    // about work that happened but is not linked yet.
    expect(evidence.sourceCounts.research).toBeGreaterThan(0);
    expect(evidence.sourceCounts.experiments).toBe(1);
    expect(evidence.sourceCounts.simulations).toBe(1);
  });

  it("does not leak one objective's evidence into another's dossier", async () => {
    const other = await getObjectiveEvidence(userId, otherObjectiveId);
    expect(other.items).toEqual([]);
    expect(other.sourceCounts).toEqual({ research: 0, experiments: 0, simulations: 0 });
  });

  it("returns an empty dossier for an objective the caller does not own", async () => {
    const stranger = await createTestUser();
    const evidence = await getObjectiveEvidence(stranger.id, objectiveId);
    expect(evidence.items).toEqual([]);
    expect(evidence.sourceCounts.research).toBe(0);
  });

  it("agrees with what the planner is given for the same objective", async () => {
    const { buildPlanningContext } = await import("@/lib/agents/context");
    const [evidence, context] = await Promise.all([
      getObjectiveEvidence(userId, objectiveId),
      buildPlanningContext(userId, "Dossier objective.", { objectiveId }),
    ]);

    const linkedForPlanner = new Set(
      context.observations.filter((o) => o.objectiveLinked).map((o) => o.content)
    );
    // Every item the user is shown is evidence the planner also sees. The two
    // read the same edges; this pins that they cannot drift apart.
    expect(evidence.items.length).toBeGreaterThan(0);
    for (const item of evidence.items) {
      expect(linkedForPlanner.has(item.content)).toBe(true);
    }
  });
});
