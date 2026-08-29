import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObjective } from "@/lib/objectives/service";
import { startSupervisorRun } from "@/lib/supervisor/service";
import { getGraph, getNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { createTestUser } from "./helpers";

/**
 * The Knowledge Graph's first autonomous writer. Before this, the graph was
 * only ever written by two detail pages and one manual API endpoint, so it
 * could only contain what a human had clicked on — structure sitting beside
 * the system rather than a record of what the system did.
 */
describe("Knowledge Graph: supervised work links itself into the graph", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("starts empty — the graph is not pre-populated with every record", async () => {
    const graph = await getGraph(userId);
    expect(graph.nodes).toEqual([]);
    expect(graph.connections).toEqual([]);
  });

  it("creates an Objective node, a Memory node, and a labelled edge when a run completes", async () => {
    const objective = await createObjective({ userId, title: "Prepare the launch checklist." });
    const supRun = await startSupervisorRun({ userId, objectiveId: objective.id });
    expect(supRun.status).toBe("COMPLETED");

    const objectiveNode = await getNodeForEntity(userId, "OBJECTIVE", objective.id);
    expect(objectiveNode).not.toBeNull();
    expect(objectiveNode!.label).toBe("Prepare the launch checklist.");
    // An objective is goal-shaped in graph terms.
    expect(objectiveNode!.type).toBe("GOAL");

    const graph = await getGraph(userId);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.connections.length).toBeGreaterThanOrEqual(1);

    // The edge says what it actually is, not a generic "related_to". Now that
    // verification exists it carries the objective-level VERDICT rather than
    // the execution status — strictly more informative, since "completed"
    // never meant the objective succeeded.
    const edge = graph.connections.find((c) => c.fromNodeId === objectiveNode!.id);
    expect(edge).toBeDefined();
    expect(edge!.relation).toMatch(/^(verified|outcome):/);
  });

  it("makes the recorded outcome reachable by traversing from the objective", async () => {
    const objective = await createObjective({ userId, title: "Traversable objective." });
    await startSupervisorRun({ userId, objectiveId: objective.id });

    const objectiveNode = await getNodeForEntity(userId, "OBJECTIVE", objective.id);
    expect(objectiveNode).not.toBeNull();

    const related = await findRelated(userId, objectiveNode!.id, 1);
    expect(related.length).toBeGreaterThan(0);
    // The neighbour is the EXPERIENCE memory holding the real result, reached
    // across an edge naming the verdict. An objective with no success criteria
    // is honestly unverified rather than silently treated as achieved.
    const memoryNeighbour = related.find((r) => r.node.memoryId != null);
    expect(memoryNeighbour).toBeDefined();
    expect(memoryNeighbour!.relation).toBe("verified:unverified");
    expect(memoryNeighbour!.direction).toBe("outgoing");
  });

  it("is idempotent — re-running the same objective does not duplicate its node", async () => {
    const objective = await createObjective({ userId, title: "Idempotency check." });
    await startSupervisorRun({ userId, objectiveId: objective.id });
    await startSupervisorRun({ userId, objectiveId: objective.id });

    const nodes = await db.knowledgeNode.findMany({ where: { userId, objectiveId: objective.id } });
    expect(nodes.length).toBe(1);
  });

  it("keeps one user's graph invisible to another", async () => {
    const stranger = await createTestUser();
    const graph = await getGraph(stranger.id);
    expect(graph.nodes).toEqual([]);
    expect(graph.connections).toEqual([]);
  });
});
