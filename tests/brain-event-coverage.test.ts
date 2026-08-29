import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { runResearch } from "@/lib/research/service";
import { createExperiment, addExperimentResult, nextExperimentCode } from "@/lib/lab/experiments";
import { createSimulation, executeSimulation } from "@/lib/lab/simulations";
import { createMemory } from "@/lib/memory/service";
import { createProject, createTask } from "@/lib/projects/service";
import { SUBJECT_TYPE_TO_SYSTEM } from "@/components/brain/three/anatomy";
import { createTestUser } from "./helpers";

/**
 * The Brain claims to be a visualization of what VOX is doing. That claim is
 * only true if everything VOX does actually reaches it.
 *
 * Live events pulse the Brain by looking their subjectType up in
 * SUBJECT_TYPE_TO_SYSTEM. A subject type missing from that map does not
 * error — it silently pulses nothing, so the work happens and the
 * visualization stays inert. That is exactly how research and Lab activity
 * went unrepresented: the events fired correctly the whole time and the
 * Brain had no idea what they were.
 *
 * This test performs real work across the domains and asserts the resulting
 * events are all representable, so adding a new event type without teaching
 * the Brain about it fails here instead of quietly degrading the product.
 */
describe("Brain event coverage: everything VOX does reaches the visualization", () => {
  let userId: string;
  let emittedSubjectTypes: string[];

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;

    const since = new Date();
    // Real work across the domains that emit consequential events.
    const objective = await createObjective({ userId, title: "Brain coverage objective." });
    await runResearch(userId, "brain coverage research", { objectiveId: objective.id });

    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: "Coverage experiment",
      hypothesis: "Events reach the Brain.",
      objectiveId: objective.id,
    });
    await addExperimentResult(userId, experiment.id, { outcome: "They do.", confidence: "ESTIMATED" });

    const scenario = await db.labScenario.create({
      data: {
        name: "Coverage scenario",
        environment: "ROOFTOP",
        objectiveType: "TIMED_TRAVERSAL",
        difficulty: "INTERMEDIATE",
        gravityMs2: 9.81,
      },
    });
    const simulation = await createSimulation({
      userId,
      name: "Coverage sim",
      scenarioId: scenario.id,
      objectiveId: objective.id,
    });
    await executeSimulation(userId, simulation.id, 5);

    await createMemory({ userId, content: "A coverage memory.", category: "FACT" });
    const project = await createProject({ userId, name: "Coverage project" });
    await createTask({ userId, title: "Coverage task", projectId: project.id });

    const events = await db.event.findMany({
      where: { userId, createdAt: { gte: since }, subjectType: { not: null } },
      select: { subjectType: true },
    });
    emittedSubjectTypes = [...new Set(events.map((e) => e.subjectType as string))];
  });

  it("emits events for the work that was performed", () => {
    // Guards the test itself: if nothing was emitted, the assertion below
    // would pass vacuously and prove nothing.
    expect(emittedSubjectTypes.length).toBeGreaterThan(4);
  });

  it("maps every emitted subject type to a Brain system", () => {
    const unmapped = emittedSubjectTypes.filter((t) => SUBJECT_TYPE_TO_SYSTEM[t] === undefined);
    // A readable failure: naming the unmapped types is what makes this
    // actionable when someone adds a domain and forgets the Brain.
    expect(unmapped).toEqual([]);
  });

  it("routes research and Lab work to the Brain's research region", () => {
    // The specific gap this test was written for — these three fired
    // correctly for weeks and pulsed nothing.
    expect(SUBJECT_TYPE_TO_SYSTEM.ResearchQuery).toBe("RESEARCH");
    expect(SUBJECT_TYPE_TO_SYSTEM.LabExperiment).toBe("RESEARCH");
    expect(SUBJECT_TYPE_TO_SYSTEM.LabSimulationRun).toBe("RESEARCH");
  });
});
