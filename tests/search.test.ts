import { describe, it, expect, beforeAll } from "vitest";
import { searchEverything } from "@/lib/search/service";
import { createMemory } from "@/lib/memory/service";
import { createProject, createTask, createGoal } from "@/lib/projects/service";
import { createObjective } from "@/lib/objectives/service";
import { createSuit } from "@/lib/lab/suits";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 70, durability: 50, mobility: 60, stretchiness: 55, weightKg: 4, thermalLoadC: 30,
  protection: 45, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 28000, flexibility: 55, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40,
};

describe("cross-domain search: searchEverything", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;

    await createMemory({ userId, content: "The user prefers lightweight impact-resistant materials for the mask.", category: "PREFERENCE" });
    await createProject({ userId, name: "Mask V3 Redesign", description: "Reduce weight while keeping protection." });
    const project = await createProject({ userId, name: "Unrelated Project" });
    await createTask({ userId, title: "Order lightweight material samples", projectId: project.id });
    const objective = await createObjective({ userId, title: "Ship Mask V3" });
    await createGoal({ userId, title: "Finalize mask material choice" });
    await createSuit({ userId, codename: "MaterialTestSuit", archetype: "Experimental", stats: SAMPLE_STATS });
    void objective;
  });

  it("returns nothing for a query shorter than 2 characters — never guesses from a fragment", async () => {
    expect(await searchEverything(userId, "")).toEqual([]);
    expect(await searchEverything(userId, "m")).toEqual([]);
  });

  it("finds real matches across memory, projects, and tasks for one query", async () => {
    const results = await searchEverything(userId, "lightweight material");

    const sources = new Set(results.map((r) => r.source));
    expect(sources.has("memory")).toBe(true);
    expect(sources.has("task")).toBe(true);

    const memoryHit = results.find((r) => r.source === "memory");
    expect(memoryHit?.href).toMatch(/^\/memory\//);

    const taskHit = results.find((r) => r.source === "task");
    expect(taskHit?.title).toContain("lightweight material samples");
  });

  it("finds a Lab suit through the reused searchLab() path", async () => {
    const results = await searchEverything(userId, "MaterialTestSuit");
    const suitHit = results.find((r) => r.source.startsWith("lab."));
    expect(suitHit).toBeDefined();
    expect(suitHit?.title).toBe("MaterialTestSuit");
    expect(suitHit?.href).toMatch(/^\/lab\/suits\//);
  });

  it("finds objectives and goals by title", async () => {
    const results = await searchEverything(userId, "Mask V3");
    expect(results.some((r) => r.source === "objective" && r.title === "Ship Mask V3")).toBe(true);
  });

  it("ranks an exact/prefix title match above a weaker substring match", async () => {
    const results = await searchEverything(userId, "Mask V3 Redesign");
    const project = results.find((r) => r.source === "project");
    expect(project).toBeDefined();
    expect(project!.relevance).toBeGreaterThanOrEqual(0.85);
  });

  it("never returns another user's data", async () => {
    const otherUser = await createTestUser();
    await createMemory({ userId: otherUser.id, content: "Secret lightweight material research for someone else.", category: "FACT" });

    const results = await searchEverything(userId, "lightweight material");
    expect(results.some((r) => r.title.includes("someone else"))).toBe(false);
  });
});
