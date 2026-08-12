import { describe, it, expect, beforeAll } from "vitest";
import { getBrainGraph, getBrainState } from "@/lib/brain/graph";
import { createObjective, createOpportunity, promoteOpportunityToProject } from "@/lib/objectives/service";
import { createTask } from "@/lib/projects/service";
import { runResearch, listResearchItems } from "@/lib/research/service";
import { createTestUser } from "./helpers";

describe("brain graph", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("returns an honest empty graph for a fresh user", async () => {
    const freshUser = await createTestUser();
    const graph = await getBrainGraph(freshUser.id);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.totals).toEqual({ memories: 0, research: 0, tasks: 0 });
  });

  it("represents an objective and its opportunity as real nodes with a real edge", async () => {
    const objective = await createObjective({ userId, title: "Generate $25,000" });
    const opportunity = await createOpportunity({
      userId,
      objectiveId: objective.id,
      title: "Freelance contract",
      estimatedValue: 4000,
      effort: "MEDIUM",
      confidence: "HIGH",
    });

    const graph = await getBrainGraph(userId);
    const objectiveNode = graph.nodes.find((n) => n.type === "OBJECTIVE" && n.entityId === objective.id);
    const opportunityNode = graph.nodes.find((n) => n.type === "OPPORTUNITY" && n.entityId === opportunity?.id);
    expect(objectiveNode).toBeDefined();
    expect(opportunityNode).toBeDefined();

    const edge = graph.edges.find((e) => e.from === objectiveNode!.id && e.to === opportunityNode!.id);
    expect(edge).toBeDefined();
    expect(edge!.relation).toBe("targets");
  });

  it("marks exactly one opportunity per objective as the next best action, matching the ranking formula", async () => {
    const objective = await createObjective({ userId, title: "Ranking objective" });
    await createOpportunity({
      userId,
      objectiveId: objective.id,
      title: "Low leverage",
      estimatedValue: 50,
      effort: "HIGH",
      confidence: "LOW",
    });
    const high = await createOpportunity({
      userId,
      objectiveId: objective.id,
      title: "High leverage",
      estimatedValue: 8000,
      effort: "LOW",
      confidence: "HIGH",
    });

    const graph = await getBrainGraph(userId);
    const nodes = graph.nodes.filter((n) => n.type === "OPPORTUNITY" && n.meta.objectiveId === objective.id);
    const flagged = nodes.filter((n) => n.meta.isNextBestAction === true);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.entityId).toBe(high!.id);
  });

  it("links a promoted opportunity to its Project node and edge", async () => {
    const objective = await createObjective({ userId, title: "Promotion objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Promote me" });
    const promotion = await promoteOpportunityToProject(userId, opportunity!.id);
    expect(promotion?.alreadyPromoted).toBe(false);

    const graph = await getBrainGraph(userId);
    const opportunityNode = graph.nodes.find((n) => n.type === "OPPORTUNITY" && n.entityId === opportunity!.id)!;
    const projectNode = graph.nodes.find((n) => n.type === "PROJECT" && n.entityId === promotion!.project.id)!;
    expect(opportunityNode.meta.projectId).toBe(promotion!.project.id);
    expect(graph.edges.some((e) => e.from === opportunityNode.id && e.to === projectNode.id && e.relation === "promoted_to")).toBe(
      true
    );

    // tasks under the promoted project connect transitively through it
    const task = await createTask({ userId, projectId: promotion!.project.id, title: "Do the work" });
    const graph2 = await getBrainGraph(userId);
    const taskNode = graph2.nodes.find((n) => n.type === "TASK" && n.entityId === task.id)!;
    expect(graph2.edges.some((e) => e.from === projectNode.id && e.to === taskNode.id && e.relation === "contains")).toBe(true);
  });

  it("promoting an already-promoted opportunity is idempotent, not a duplicate project", async () => {
    const objective = await createObjective({ userId, title: "Idempotent objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Promote once" });
    const first = await promoteOpportunityToProject(userId, opportunity!.id);
    const second = await promoteOpportunityToProject(userId, opportunity!.id);
    expect(second?.alreadyPromoted).toBe(true);
    expect(second?.project.id).toBe(first?.project.id);
  });

  it("scopes research to an opportunity and represents it as an evidenced_by edge", async () => {
    const objective = await createObjective({ userId, title: "Research objective" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Needs research" });
    await runResearch(userId, "market size for this opportunity", opportunity!.id);

    const scoped = await listResearchItems(userId, 50, opportunity!.id);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((r) => r.opportunityId === opportunity!.id)).toBe(true);

    const graph = await getBrainGraph(userId);
    const opportunityNode = graph.nodes.find((n) => n.type === "OPPORTUNITY" && n.entityId === opportunity!.id)!;
    const researchNodes = graph.nodes.filter((n) => n.type === "RESEARCH" && n.meta.opportunityId === opportunity!.id);
    expect(researchNodes.length).toBeGreaterThan(0);
    expect(graph.edges.some((e) => e.from === opportunityNode.id && e.to === researchNodes[0]!.id && e.relation === "evidenced_by")).toBe(
      true
    );
  });

  it("ignores an opportunityId the caller doesn't own instead of attaching research to it", async () => {
    const otherUser = await createTestUser();
    const objective = await createObjective({ userId: otherUser.id, title: "Not mine" });
    const opportunity = await createOpportunity({ userId: otherUser.id, objectiveId: objective.id, title: "Not mine either" });

    const items = await runResearch(userId, "some query", opportunity!.id);
    expect(items.every((i) => i.opportunityId == null)).toBe(true);
  });

  it("brain state is idle with no agent runs or pending proposals", async () => {
    const freshUser = await createTestUser();
    const state = await getBrainState(freshUser.id);
    expect(state.state).toBe("idle");
    expect(state.detail).toBeNull();
  });
});
