import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { runResearch } from "@/lib/research/service";
import { createExperiment, addExperimentResult, nextExperimentCode } from "@/lib/lab/experiments";
import { createSimulation, executeSimulation } from "@/lib/lab/simulations";
import { getNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { buildPlanningContext, renderPlanningContext } from "@/lib/agents/context";
import { EVIDENCE_RELATION, EXPERIENCE_PROVENANCE, isEvidenceRelation } from "@/lib/cognition/experience";
import { recordResearchExperience } from "@/lib/research/learning";
import { listMemoriesByProvenance } from "@/lib/memory/service";
import { createTestUser } from "./helpers";

/**
 * The question this feature exists to answer: "what evidence do I have
 * specifically BECAUSE I am pursuing this objective?"
 *
 * Before it, research and Lab results were durable and reachable, but only by
 * recency — so a planning pass for objective B could be handed research
 * gathered for objective A and have no way to tell. The tests that matter
 * most here are the negative ones: evidence must not leak between objectives,
 * and being objective-linked must not upgrade what the evidence actually is.
 */

async function seedScenario(name = "Rooftop traversal") {
  return db.labScenario.create({
    data: {
      name,
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

describe("Research is retained against the objective it was run for", () => {
  let userId: string;
  let objectiveA: string;
  let objectiveB: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    objectiveA = (await createObjective({ userId, title: "Ship a weather-resistant outer layer." })).id;
    objectiveB = (await createObjective({ userId, title: "Reduce total suit mass below 3 kg." })).id;

    await runResearch(userId, "hydrophobic coatings for technical textiles", { objectiveId: objectiveA });
  });

  it("stores the objective on the ResearchItem itself, not only in the graph", async () => {
    // The durable record. Graph writes are best-effort by design, so the
    // association has to survive at the source of truth independently.
    const items = await db.researchItem.findMany({ where: { userId, objectiveId: objectiveA } });
    expect(items.length).toBeGreaterThan(0);
  });

  it("draws an evidence edge from the objective to what was found", async () => {
    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveA);
    expect(node).not.toBeNull();

    const related = await findRelated(userId, node!.id, 1);
    const edge = related.find((r) => r.relation === EVIDENCE_RELATION.RESEARCH);
    expect(edge).toBeDefined();
    expect(edge!.direction).toBe("outgoing");
    expect(edge!.node.memoryId).not.toBeNull();
  });

  it("A: retrieves that research as Objective A's own evidence", async () => {
    const context = await buildPlanningContext(userId, "outer layer", { objectiveId: objectiveA });
    const linked = context.observations.filter((o) => o.objectiveLinked);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every((o) => o.provenance === EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS)).toBe(true);
  });

  it("B: does not present Objective A's research as Objective B's evidence", async () => {
    const context = await buildPlanningContext(userId, "outer layer", { objectiveId: objectiveB });
    // The finding is still visible — it is real, recent, and the planner may
    // want it — but it must never be labelled as gathered for THIS objective.
    expect(context.observations.filter((o) => o.objectiveLinked)).toEqual([]);

    const rendered = renderPlanningContext(context);
    expect(rendered).not.toContain("Evidence gathered specifically in pursuit of THIS objective");
    expect(rendered).toContain("NOT gathered for this objective");
  });

  it("G: objective-linked research with no real sources stays an unsupported-claim-free record", async () => {
    // The mock provider retrieves nothing substantive, so there is correctly
    // no source node to point at. The objective link must not paper over
    // that — an objective-linked finding with no sources has to still read as
    // "unresearched", or linking would be manufacturing evidence.
    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveA);
    const related = await findRelated(userId, node!.id, 2);
    const evidenceEdge = related.find((r) => isEvidenceRelation(r.relation));
    expect(evidenceEdge).toBeDefined();

    const [memory] = await listMemoriesByProvenance(userId, [EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS], 1);
    expect(memory.content).toMatch(/no usable sources|unresearched/i);
  });

  it("G: keeps the provenance chain walkable back to the source when sources exist", async () => {
    // objective -> finding -> source. Exercised through the real recording
    // pathway over real persisted ResearchItem rows, since no configured
    // provider in the test environment returns sourced results.
    const objectiveId = (await createObjective({ userId, title: "Sourced-evidence objective." })).id;
    const item = await db.researchItem.create({
      data: {
        userId,
        objectiveId,
        query: "seam sealing tape peel strength",
        provider: "test-fixture",
        title: "Peel strength of seam tapes",
        sourceUrl: "https://example.org/seam-tape-peel",
        summary: "Reports peel strength across three tape classes.",
        relevance: 0.8,
        confidence: "MEDIUM",
      },
    });

    await recordResearchExperience({
      userId,
      query: "seam sealing tape peel strength",
      providerId: "test-fixture",
      items: [item],
      objectiveId,
    });

    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveId);
    const related = await findRelated(userId, node!.id, 2);

    // Both edges survive: the objective edge makes it retrievable, the source
    // edge keeps it attributable. Dropping either would turn a sourced claim
    // into an assertion.
    expect(related.some((r) => r.relation === EVIDENCE_RELATION.RESEARCH)).toBe(true);
    const sourceEdge = related.find((r) => r.relation === "sourced");
    expect(sourceEdge).toBeDefined();
    expect(sourceEdge!.node.researchItemId).toBe(item.id);

    // And the memory itself keeps a direct provenance link to the source row.
    const [memory] = await listMemoriesByProvenance(userId, [EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS], 1);
    expect(memory.source?.researchItemId).toBe(item.id);
    // The URL stays in the text, so provenance survives even without the graph.
    expect(memory.content).toContain("https://example.org/seam-tape-peel");
  });

  it("refuses to attach evidence to another user's objective", async () => {
    const stranger = await createTestUser();
    const theirs = await createObjective({ userId: stranger.id, title: "Not yours." });
    await runResearch(userId, "unowned objective attempt", { objectiveId: theirs.id });

    // The research still ran — it just did not attach to a goal that isn't
    // this user's. Unscoped is the correct failure mode, not an error.
    const leaked = await db.researchItem.findMany({ where: { userId, objectiveId: theirs.id } });
    expect(leaked).toEqual([]);
    const strangerContext = await buildPlanningContext(stranger.id, "unowned", { objectiveId: theirs.id });
    expect(strangerContext.observations.filter((o) => o.objectiveLinked)).toEqual([]);
  });
});

describe("Lab work is retained against the objective it was run for", () => {
  let userId: string;
  let objectiveId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    objectiveId = (await createObjective({ userId, title: "Cut impact transfer through the forearm plate." })).id;
  });

  it("C: links an experiment result to its originating objective", async () => {
    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: "Lattice impact test",
      hypothesis: "A gyroid lattice absorbs more impact per gram than a honeycomb.",
      objectiveId,
    });
    expect(experiment.objectiveId).toBe(objectiveId);

    await addExperimentResult(userId, experiment.id, {
      outcome: "Gyroid absorbed 14% more energy per gram.",
      confidence: "ESTIMATED",
    });

    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveId);
    const related = await findRelated(userId, node!.id, 1);
    expect(related.some((r) => r.relation === EVIDENCE_RELATION.EXPERIMENT)).toBe(true);

    // objective -> result -> experiment stays walkable.
    const deep = await findRelated(userId, node!.id, 2);
    expect(deep.some((r) => r.relation === "produced_result")).toBe(true);
  });

  it("D: links a simulation run to its originating objective", async () => {
    const scenario = await seedScenario();
    const simulation = await createSimulation({
      userId,
      name: "Impact envelope",
      scenarioId: scenario.id,
      objectiveId,
    });
    expect(simulation.objectiveId).toBe(objectiveId);

    const run = await executeSimulation(userId, simulation.id, 4242);
    expect(run).not.toBeNull();

    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveId);
    const related = await findRelated(userId, node!.id, 1);
    expect(related.some((r) => r.relation === EVIDENCE_RELATION.SIMULATION)).toBe(true);
  });

  it("E: puts objective-specific evidence ahead of merely-recent observations", async () => {
    // Unrelated, and newer than everything above — recency alone would rank
    // it first, which is precisely the behaviour being replaced.
    await runResearch(userId, "completely unrelated topic about paint drying");

    const context = await buildPlanningContext(userId, "forearm plate", { objectiveId });
    expect(context.observations[0].objectiveLinked).toBe(true);

    const firstUnlinked = context.observations.findIndex((o) => !o.objectiveLinked);
    const lastLinked = context.observations.map((o) => o.objectiveLinked).lastIndexOf(true);
    if (firstUnlinked !== -1) expect(lastLinked).toBeLessThan(firstUnlinked);

    // Both grades reached the planner, each under its own heading.
    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("Evidence gathered specifically in pursuit of THIS objective");
    expect(rendered).toContain("NOT gathered for this objective");
  });

  it("F: never emits the same evidence twice", async () => {
    const context = await buildPlanningContext(userId, "forearm plate", { objectiveId });

    const contents = context.observations.map((o) => o.content);
    expect(new Set(contents).size).toBe(contents.length);

    // And it must not reappear through semantic retrieval either — one
    // finding shown twice reads as two pieces of corroborating evidence.
    const observed = new Set(contents);
    expect(context.memories.some((m) => observed.has(m.content))).toBe(false);
  });

  it("H: an objective-linked simulation is still only a model output", async () => {
    const context = await buildPlanningContext(userId, "forearm plate", { objectiveId });
    const simulated = context.observations.find(
      (o) => o.provenance === EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN
    );
    expect(simulated).toBeDefined();
    expect(simulated!.objectiveLinked).toBe(true);

    // Linking evidence to a goal says where it came from. It must not change
    // what the evidence IS.
    expect(simulated!.content.startsWith("SIMULATED RESULT — not a physical measurement.")).toBe(true);
    expect(simulated!.confidence).toBe("LOW");

    const rendered = renderPlanningContext(context);
    expect(rendered).toContain("not evidence that anything was physically built or tested");
    expect(rendered).toContain("never raises its grade and is never corroboration");
    // The planner is told how to read each grade, including the user-stated one.
    expect(rendered).toContain("Only memories the user stated directly are established facts");
  });

  it("does not move objective progress just because evidence accumulated", async () => {
    const objective = await db.objective.findUnique({ where: { id: objectiveId } });
    // currentValue changes only through explicit updateObjective() input.
    expect(objective!.currentValue).toBeNull();
    expect(objective!.status).toBe("ACTIVE");
  });
});

describe("Unscoped work behaves exactly as before", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("I: research, experiments and simulations still work with no objective", async () => {
    const items = await runResearch(userId, "unscoped lookup");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].objectiveId).toBeNull();

    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({ userId, code, title: "Unscoped", hypothesis: "H" });
    expect(experiment.objectiveId).toBeNull();
    const result = await addExperimentResult(userId, experiment.id, { outcome: "Recorded." });
    expect(result).not.toBeNull();

    const scenario = await seedScenario("Unscoped scenario");
    const simulation = await createSimulation({ userId, name: "Unscoped sim", scenarioId: scenario.id });
    expect(simulation.objectiveId).toBeNull();
    expect(await executeSimulation(userId, simulation.id, 11)).not.toBeNull();

    // All of it still reaches planning by recency — the previous behaviour,
    // unchanged. It is simply never claimed as any objective's own evidence.
    const context = await buildPlanningContext(userId, "unscoped lookup");
    expect(context.observations.length).toBeGreaterThan(0);
    expect(context.observations.every((o) => o.objectiveLinked === false)).toBe(true);
  });

  it("recognises evidence relations and nothing else", () => {
    expect(isEvidenceRelation(EVIDENCE_RELATION.RESEARCH)).toBe(true);
    expect(isEvidenceRelation(EVIDENCE_RELATION.EXPERIMENT)).toBe(true);
    expect(isEvidenceRelation(EVIDENCE_RELATION.SIMULATION)).toBe(true);
    // A supervised run's verdict edge is about how an attempt went, not about
    // evidence gathered along the way, and must not be swept in.
    expect(isEvidenceRelation("verified:unverified")).toBe(false);
    expect(isEvidenceRelation("sourced")).toBe(false);
    expect(isEvidenceRelation("produced_result")).toBe(false);
  });
});
