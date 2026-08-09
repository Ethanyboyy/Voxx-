import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { createMemory, getSemanticMemories } from "@/lib/memory/service";
import { createProject } from "@/lib/projects/service";
import { runResearch } from "@/lib/research/service";
import { ensureNodeForEntity, createConnection, findRelated } from "@/lib/knowledge/service";
import { detectPatterns } from "@/lib/cognition/patterns";
import { listProposals, approveProposal } from "@/lib/cognition/proposals";
import { listRecentEvents } from "@/lib/observability/events";
import { grantPermission, PermissionDeniedError } from "@/lib/permissions/service";
import { listTasks } from "@/lib/projects/service";
import { createTestUser } from "./helpers";

/**
 * Exercises the full cognitive loop described in PHASE_2_ARCHITECTURE.md §11
 * end to end, across real subsystems (no step is scripted/faked output):
 *
 *   OBSERVE (pattern detector reads real state)
 *     -> MEMORY (semantic retrieval finds the relevant memory)
 *     -> RESEARCH (a research query is run and persisted)
 *     -> KNOWLEDGE GRAPH (project, memory, and research connected)
 *     -> PATTERN/INSIGHT (a Pattern is recorded)
 *     -> PROPOSED ACTION (a Proposal is created, not executed)
 *     -> PERMISSION (denied by default, then explicitly granted)
 *     -> RESULT (the action actually runs and is recorded)
 *
 * This mirrors a manual end-to-end run performed against the live dev
 * server during development (register -> seed stale decisions -> detect
 * patterns -> see the proposal in the UI -> get a real 403 -> grant
 * permission in Settings -> approve -> see the task actually created).
 */
describe("full cognitive loop integration", () => {
  it("observes, retrieves memory, researches, connects the graph, proposes, gates on permission, and records a real result", async () => {
    const user = await createTestUser();

    // --- Setup: a project and a memory relevant to it -----------------------
    const project = await createProject({ userId: user.id, name: "Pokemon Shop Expansion" });
    const memory = await createMemory({
      userId: user.id,
      content: "The Pokemon Shop is considering opening a second location downtown",
      category: "FACT",
      confidence: "HIGH",
    });

    // --- MEMORY: semantic retrieval surfaces it for a related query ---------
    const semanticMatches = await getSemanticMemories(user.id, "should the Pokemon shop expand to a new location?", 5);
    expect(semanticMatches.some((m) => m.id === memory.id)).toBe(true);

    // --- RESEARCH: a real (mock-provider) research query is run and persisted
    const researchItems = await runResearch(user.id, "average cost to open a second retail trading card location");
    expect(researchItems.length).toBeGreaterThan(0);

    // --- KNOWLEDGE GRAPH: connect the project, the memory, and the research -
    const projectNode = await ensureNodeForEntity(user.id, "PROJECT", project.id, project.name);
    const memoryNode = await ensureNodeForEntity(user.id, "MEMORY", memory.id, "Considering a second location");
    const researchNode = await ensureNodeForEntity(user.id, "RESEARCH_ITEM", researchItems[0].id, researchItems[0].title ?? "Research");

    await createConnection({ userId: user.id, fromNodeId: projectNode.id, toNodeId: memoryNode.id, relation: "informed_by" });
    await createConnection({ userId: user.id, fromNodeId: projectNode.id, toNodeId: researchNode.id, relation: "informed_by" });

    const relatedToProject = await findRelated(user.id, projectNode.id, 1);
    expect(relatedToProject.map((r) => r.node.id).sort()).toEqual([memoryNode.id, researchNode.id].sort());

    // --- OBSERVE + PATTERN/INSIGHT: two stale pending decisions on this project
    const staleCutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    for (const title of ["Pick a location for the second shop", "Decide on lease terms"]) {
      const decision = await db.decision.create({
        data: { userId: user.id, projectId: project.id, title, status: "PENDING" },
      });
      await db.decision.update({ where: { id: decision.id }, data: { createdAt: staleCutoff } });
    }

    const detected = await detectPatterns(user.id);
    expect(detected.some((p) => p.type === "UNRESOLVED_DECISION")).toBe(true);

    // --- PROPOSED ACTION: a Proposal exists, not yet executed ---------------
    const proposals = await listProposals(user.id, "PROPOSED");
    const proposal = proposals.find((p) => p.capability === "cognition.proposal.unresolved_decision");
    expect(proposal).toBeDefined();
    expect(proposal!.status).toBe("PROPOSED");
    expect(proposal!.observation).toBeTruthy();
    expect(proposal!.suggestedAction).toBeTruthy();

    // --- PERMISSION: denied by default -- nothing executes without consent --
    await expect(approveProposal(user.id, proposal!.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    const stillProposed = await listProposals(user.id, "PROPOSED");
    expect(stillProposed.some((p) => p.id === proposal!.id)).toBe(true);
    const tasksBeforeGrant = await listTasks(user.id);
    expect(tasksBeforeGrant).toHaveLength(0);

    // Explicit grant — the same permission system used everywhere else in VOX.
    await grantPermission(user.id, proposal!.capability, proposal!.requiredLevel);

    // --- RESULT: approval now succeeds and the action really happens --------
    const executed = await approveProposal(user.id, proposal!.id);
    expect(executed?.status).toBe("EXECUTED");
    expect(executed?.result).toBeTruthy();
    expect(executed?.resolvedAt).toBeInstanceOf(Date);

    const tasksAfter = await listTasks(user.id);
    expect(tasksAfter.length).toBe(1);
    expect(tasksAfter[0].title).toContain("Pick a location for the second shop");

    // --- Auditability: every consequential step left a durable Event trail --
    const events = await listRecentEvents(user.id, 200);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("proposal.created");
    expect(eventTypes).toContain("proposal.approved");
    expect(eventTypes).toContain("proposal.executed");
    expect(eventTypes).toContain("cognition.patterns_detected");
    expect(eventTypes).toContain("research.performed");
    expect(eventTypes).toContain("permission.granted");
  });
});
