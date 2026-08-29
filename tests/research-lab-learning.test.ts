import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { runResearch } from "@/lib/research/service";
import { createExperiment, addExperimentResult, nextExperimentCode } from "@/lib/lab/experiments";
import { createSimulation, executeSimulation } from "@/lib/lab/simulations";
import { getNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { buildPlanningContext, renderPlanningContext } from "@/lib/agents/context";
import { aggregateSourceConfidence, isSubstantiveResult } from "@/lib/research/learning";
import { EXPERIENCE_PROVENANCE, labConfidenceToMemoryConfidence } from "@/lib/cognition/experience";
import { createTestUser } from "./helpers";

/**
 * Research and the Lab were the two largest bodies of genuinely-working code
 * that VOX could not learn anything from: both produced real persisted
 * results that never reached Memory, the Knowledge Graph, or a planning
 * pass. These tests exercise the whole pathway end to end — real work ->
 * durable memory -> graph edge -> next plan — and, just as importantly, pin
 * down the claims VOX is NOT allowed to make on the way through.
 */

async function seedScenario() {
  return db.labScenario.create({
    data: {
      name: "Rooftop traversal",
      environment: "ROOFTOP",
      objectiveType: "TIMED_TRAVERSAL",
      difficulty: "INTERMEDIATE",
      windMs: 4,
      temperatureC: 21,
      gravityMs2: 9.81,
      elevationM: 60,
      obstacleCount: 12,
    },
  });
}

describe("Research feeds the organism", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("records what was retrieved as a durable memory carrying its sources", async () => {
    const items = await runResearch(userId, "thermal regulation in lightweight protective fabrics");
    expect(items.length).toBeGreaterThan(0);

    const memory = await db.memory.findFirst({
      where: { userId, provenance: EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS },
      orderBy: { createdAt: "desc" },
    });
    expect(memory).not.toBeNull();
    // Findings are observations about the world, never facts VOX now holds.
    expect(memory!.category).toBe("OBSERVATION");
    // A retrieved document is evidence at best — CONFIRMED is reserved for
    // things the user stated directly.
    expect(memory!.confidence).not.toBe("CONFIRMED");
  });

  it("does not present an unconfigured provider's placeholder as a finding", async () => {
    // The mock provider returns one zero-relevance, URL-less placeholder that
    // says research is not configured. Writing that into memory as though it
    // were a finding would let a later planning pass read "no provider
    // configured" as evidence about the subject.
    const context = await buildPlanningContext(userId, "thermal regulation in lightweight protective fabrics");
    const research = context.observations.filter((o) => o.provenance === EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS);
    expect(research.length).toBeGreaterThan(0);
    expect(research[0].content).toMatch(/no usable sources|unresearched/i);
    // And it must not claim anything was learned.
    expect(research[0].content).not.toMatch(/\d+ source\(s\) returned/);
  });

  it("caps aggregated source confidence at HIGH so a provider cannot self-certify", () => {
    expect(aggregateSourceConfidence([{ confidence: "CONFIRMED" }])).toBe("HIGH");
    expect(aggregateSourceConfidence([{ confidence: "LOW" }, { confidence: "MEDIUM" }])).toBe("MEDIUM");
    expect(aggregateSourceConfidence([])).toBe("LOW");
  });

  it("treats a URL-less, zero-relevance result as no result at all", () => {
    expect(isSubstantiveResult({ sourceUrl: null, relevance: 0 })).toBe(false);
    expect(isSubstantiveResult({ sourceUrl: null, relevance: null })).toBe(false);
    expect(isSubstantiveResult({ sourceUrl: "https://example.com", relevance: 0 })).toBe(true);
    expect(isSubstantiveResult({ sourceUrl: null, relevance: 0.4 })).toBe(true);
  });

  it("writes a consequential event, since research reaches outside VOX", async () => {
    const event = await db.event.findFirst({
      where: { userId, type: "research.recorded" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event!.consequential).toBe(true);
  });
});

describe("Lab experiments feed the organism", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("carries hypothesis, configuration, expectation and actual outcome into memory and the graph", async () => {
    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: "Weave density vs. mobility",
      hypothesis: "A looser weave increases mobility without reducing tear strength.",
      variables: [{ name: "weave density", value: "180", unit: "g/m2" }],
      expectedOutcome: "Mobility up at least 5% with no measurable strength loss.",
    });

    await addExperimentResult(userId, experiment.id, {
      outcome: "Mobility rose 6%; tear strength fell 11%.",
      learnings: "The strength trade-off is real and was not anticipated.",
      confidence: "ESTIMATED",
    });

    const memory = await db.memory.findFirst({
      where: { userId, provenance: EXPERIENCE_PROVENANCE.LAB_EXPERIMENT_RESULT },
      orderBy: { createdAt: "desc" },
    });
    expect(memory).not.toBeNull();

    // The graph is the part that makes the Lab stop being a silo: the
    // experiment is reachable from the rest of VOX's knowledge.
    const node = await getNodeForEntity(userId, "LAB_EXPERIMENT", experiment.id);
    expect(node).not.toBeNull();
    const related = await findRelated(userId, node!.id, 1);
    const resultEdge = related.find((r) => r.relation === "produced_result");
    expect(resultEdge).toBeDefined();
    expect(resultEdge!.direction).toBe("outgoing");
    expect(resultEdge!.node.memoryId).toBe(memory!.id);
  });

  it("renders the experiment's real inputs and outcome, not a verdict VOX invented", async () => {
    const context = await buildPlanningContext(userId, "weave density");
    const observation = context.observations.find(
      (o) => o.provenance === EXPERIENCE_PROVENANCE.LAB_EXPERIMENT_RESULT
    );
    expect(observation).toBeDefined();
    expect(observation!.content).toContain("A looser weave increases mobility");
    expect(observation!.content).toContain("weave density = 180 g/m2");
    expect(observation!.content).toContain("Mobility rose 6%; tear strength fell 11%.");
    // The recorded confidence is attributed to the experimenter, not asserted
    // by VOX as an independent judgement.
    expect(observation!.content).toMatch(/has not independently confirmed/i);
  });

  it("never promotes a Lab confidence to CONFIRMED", () => {
    expect(labConfidenceToMemoryConfidence("VERIFIED")).toBe("HIGH");
    expect(labConfidenceToMemoryConfidence("ESTIMATED")).toBe("MEDIUM");
    expect(labConfidenceToMemoryConfidence("HYPOTHETICAL")).toBe("LOW");
    expect(labConfidenceToMemoryConfidence("UNKNOWN")).toBe("LOW");
  });
});

describe("Lab simulations feed the organism — labelled as simulations", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("records seed, modeled inputs, and measurements so the run is reproducible from memory", async () => {
    const scenario = await seedScenario();
    const simulation = await createSimulation({
      userId,
      name: "Traversal envelope",
      scenarioId: scenario.id,
      userMassKg: 72,
      skillLevel: 60,
    });

    const run = await executeSimulation(userId, simulation.id, 4242);
    expect(run).not.toBeNull();

    const memory = await db.memory.findFirst({
      where: { userId, provenance: EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN },
      orderBy: { createdAt: "desc" },
    });
    expect(memory).not.toBeNull();

    const node = await getNodeForEntity(userId, "LAB_SIMULATION", simulation.id);
    expect(node).not.toBeNull();
    const related = await findRelated(userId, node!.id, 1);
    expect(related.some((r) => r.relation === "simulated")).toBe(true);
  });

  it("states it is a model output before it states any number", async () => {
    const context = await buildPlanningContext(userId, "traversal envelope");
    const observation = context.observations.find(
      (o) => o.provenance === EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN
    );
    expect(observation).toBeDefined();

    // This is the single most important assertion in the file. A future
    // planning pass reads this text with none of the context that produced
    // it, so the framing has to survive in the memory itself.
    expect(observation!.content.startsWith("SIMULATED RESULT — not a physical measurement.")).toBe(true);
    expect(observation!.content).toMatch(/not evidence that any physical system was built, tested/i);

    // Reproducibility: seed and modeled inputs are present.
    expect(observation!.content).toContain("seed 4242");
    expect(observation!.content).toContain("user mass 72 kg");
    expect(observation!.content).toContain("gravity 9.81 m/s²");

    // Measurements are named as model outputs.
    expect(observation!.content).toMatch(/Model outputs: peak velocity [\d.]+ m\/s/);

    // Uncertainty is recorded as part of the finding, not omitted.
    expect(observation!.content).toMatch(/Uncertainty:/);
    expect(observation!.content).toMatch(/are absent from these figures, not shown to be negligible/i);

    // Model output is the weakest evidence VOX holds, however precise it looks.
    expect(observation!.confidence).toBe("LOW");
  });
});

describe("One pathway, not three silos", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("puts research and Lab findings in front of the planner, correctly attributed", async () => {
    await runResearch(userId, "impact-absorbing lattice geometries");

    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: "Lattice impact test",
      hypothesis: "A gyroid lattice absorbs more impact per gram than a honeycomb.",
    });
    await addExperimentResult(userId, experiment.id, {
      outcome: "Gyroid absorbed 14% more energy per gram.",
      confidence: "ESTIMATED",
    });

    const scenario = await seedScenario();
    const simulation = await createSimulation({ userId, name: "Impact envelope", scenarioId: scenario.id });
    await executeSimulation(userId, simulation.id, 7);

    const context = await buildPlanningContext(userId, "impact-absorbing lattice geometries");

    // All three sources reached the same planning context through the same
    // mechanism — that is what stops them being separate features.
    const kinds = new Set(context.observations.map((o) => o.kind));
    expect(kinds.has("research")).toBe(true);
    expect(kinds.has("lab experiment")).toBe(true);
    expect(kinds.has("lab simulation")).toBe(true);

    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("What VOX has actually looked up or measured");
    // The planner is told how to read each kind, so it cannot treat a model
    // output or a retrieved claim as established fact.
    expect(rendered).toContain("a retrieved claim with a source attached, not a verified fact");
    expect(rendered).toContain("is not evidence that anything was physically built or tested");
    expect(rendered).toContain("[lab simulation, confidence LOW]");
  });

  it("does not let one finding appear twice and look like corroboration", async () => {
    const context = await buildPlanningContext(userId, "impact-absorbing lattice geometries");
    const observationContents = new Set(context.observations.map((o) => o.content));
    // Semantic memory retrieval reads the same store, so an observation could
    // legitimately surface in both lists; showing it twice would inflate one
    // piece of evidence into two.
    expect(context.memories.some((m) => observationContents.has(m.content))).toBe(false);
  });

  it("keeps one user's findings invisible to another", async () => {
    const stranger = await createTestUser();
    const context = await buildPlanningContext(stranger.id, "impact-absorbing lattice geometries");
    expect(context.observations).toEqual([]);
  });
});
