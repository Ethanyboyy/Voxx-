import { describe, it, expect, beforeAll } from "vitest";
import {
  createObjective,
  listObjectives,
  getActiveObjective,
  getObjective,
  updateObjective,
  deleteObjective,
  createOpportunity,
  listOpportunities,
  updateOpportunity,
  deleteOpportunity,
  getNextBestAction,
} from "@/lib/objectives/service";
import { createTestUser } from "./helpers";

describe("objectives and opportunities", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates an objective with sensible defaults and no fabricated progress", async () => {
    const objective = await createObjective({ userId, title: "Generate $25,000" });
    expect(objective.status).toBe("ACTIVE");
    expect(objective.currentValue).toBeNull();
    expect(objective.assumptions).toEqual([]);
  });

  it("scopes objectives to their owner", async () => {
    const otherUser = await createTestUser();
    await createObjective({ userId: otherUser.id, title: "Not mine" });
    const mine = await listObjectives(userId);
    expect(mine.some((o) => o.title === "Not mine")).toBe(false);
  });

  it("getActiveObjective returns the most recently updated ACTIVE objective, or null with none", async () => {
    const freshUser = await createTestUser();
    expect(await getActiveObjective(freshUser.id)).toBeNull();

    const objective = await createObjective({ userId: freshUser.id, title: "Ship the launch" });
    const active = await getActiveObjective(freshUser.id);
    expect(active?.id).toBe(objective.id);
  });

  it("updateObjective only changes currentValue from explicit input, never auto-increments", async () => {
    const objective = await createObjective({
      userId,
      title: "Save for a trip",
      targetValue: 2000,
      targetUnit: "USD",
    });
    expect(objective.currentValue).toBeNull();

    const updated = await updateObjective(userId, objective.id, { currentValue: 500 });
    expect(updated?.currentValue).toBe(500);

    const reread = await getObjective(userId, objective.id);
    expect(reread?.currentValue).toBe(500);
  });

  it("update/delete are scoped to the owner", async () => {
    const objective = await createObjective({ userId, title: "Scoped objective" });
    const otherUser = await createTestUser();
    expect(await updateObjective(otherUser.id, objective.id, { status: "PAUSED" })).toBeNull();
    expect(await deleteObjective(otherUser.id, objective.id)).toBe(false);
    expect(await deleteObjective(userId, objective.id)).toBe(true);
  });

  it("creates an opportunity under an objective the user owns, rejects otherwise", async () => {
    const objective = await createObjective({ userId, title: "Freelance income" });
    const opportunity = await createOpportunity({
      userId,
      objectiveId: objective.id,
      title: "Take on a contract gig",
      estimatedValue: 3000,
      effort: "MEDIUM",
      confidence: "MEDIUM",
      risk: "LOW",
      nextAction: "Reach out to three past clients",
    });
    expect(opportunity?.status).toBe("IDEA");
    expect(opportunity?.evidence).toEqual([]);

    const otherUser = await createTestUser();
    const rejected = await createOpportunity({ userId: otherUser.id, objectiveId: objective.id, title: "Not allowed" });
    expect(rejected).toBeNull();
  });

  it("lists opportunities scoped to an objective and updates/deletes scoped to the owner", async () => {
    const objective = await createObjective({ userId, title: "Objective with opportunities" });
    await createOpportunity({ userId, objectiveId: objective.id, title: "Option A" });
    await createOpportunity({ userId, objectiveId: objective.id, title: "Option B" });

    const opportunities = await listOpportunities(userId, objective.id);
    expect(opportunities).toHaveLength(2);

    const otherUser = await createTestUser();
    expect(await updateOpportunity(otherUser.id, opportunities[0].id, { status: "ACTIVE" })).toBeNull();

    const updated = await updateOpportunity(userId, opportunities[0].id, { status: "ACTIVE" });
    expect(updated?.status).toBe("ACTIVE");

    expect(await deleteOpportunity(userId, opportunities[0].id)).toBe(true);
    expect(await listOpportunities(userId, objective.id)).toHaveLength(1);
  });

  it("getNextBestAction returns null with no active objective, and never invents an action", async () => {
    const freshUser = await createTestUser();
    expect(await getNextBestAction(freshUser.id)).toBeNull();

    const objective = await createObjective({ userId: freshUser.id, title: "New objective, no opportunities yet" });
    const result = await getNextBestAction(freshUser.id);
    expect(result?.objective.id).toBe(objective.id);
    expect(result?.opportunity).toBeNull();
    expect(result?.action).toBeNull();
  });

  it("getNextBestAction ranks the higher-leverage opportunity without fabricating values", async () => {
    const freshUser = await createTestUser();
    const objective = await createObjective({ userId: freshUser.id, title: "Ranking test" });
    await createOpportunity({
      userId: freshUser.id,
      objectiveId: objective.id,
      title: "Low value, high effort",
      estimatedValue: 100,
      effort: "HIGH",
      confidence: "LOW",
      nextAction: "Do the small thing",
    });
    const highLeverage = await createOpportunity({
      userId: freshUser.id,
      objectiveId: objective.id,
      title: "High value, low effort",
      estimatedValue: 5000,
      effort: "LOW",
      confidence: "HIGH",
      nextAction: "Do the big thing",
    });

    const result = await getNextBestAction(freshUser.id);
    expect(result?.opportunity?.id).toBe(highLeverage?.id);
    expect(result?.action).toBe("Do the big thing");
  });
});
