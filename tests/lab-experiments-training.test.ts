import { describe, it, expect, beforeAll } from "vitest";
import { createExperiment, nextExperimentCode, updateExperiment, addExperimentResult, getExperiment } from "@/lib/lab/experiments";
import { recordTrainingSession, getTrainingProgress } from "@/lib/lab/training";
import { db } from "@/lib/db";
import { createTestUser } from "./helpers";

describe("lab experiments service", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("generates sequential per-user experiment codes", async () => {
    const codeA = await nextExperimentCode(userId);
    await createExperiment({ userId, code: codeA, title: "First", hypothesis: "H1" });
    const codeB = await nextExperimentCode(userId);
    expect(codeB).not.toBe(codeA);
  });

  it("starts HYPOTHETICAL by default and records status transitions + results", async () => {
    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({ userId, code, title: "Mass reduction trial", hypothesis: "Lighter suits move faster" });
    expect(experiment.confidence).toBe("HYPOTHETICAL");
    expect(experiment.status).toBe("PLANNED");

    await updateExperiment(userId, experiment.id, { status: "RUNNING" });
    await addExperimentResult(userId, experiment.id, { outcome: "Mobility improved 8%", confidence: "ESTIMATED" });
    const completed = await updateExperiment(userId, experiment.id, { status: "COMPLETED" });
    expect(completed?.status).toBe("COMPLETED");

    const full = await getExperiment(userId, experiment.id);
    expect(full?.results).toHaveLength(1);
    expect(full?.results[0].outcome).toBe("Mobility improved 8%");
  });

  it("does not let one user update another user's experiment", async () => {
    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({ userId, code, title: "Owned", hypothesis: "H" });
    const other = await createTestUser();
    const result = await updateExperiment(other.id, experiment.id, { status: "FAILED" });
    expect(result).toBeNull();
  });
});

describe("lab training service", () => {
  let userId: string;
  let moduleId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const trainingModule = await db.labTrainingModule.create({
      data: {
        name: "Test Reflex Module",
        category: "REACTION",
        difficulty: "BEGINNER",
        description: "d",
        objective: "o",
        durationMinutesEstimate: 5,
      },
    });
    moduleId = trainingModule.id;
  });

  it("computes a composite score only from the metrics actually submitted", async () => {
    const fast = await recordTrainingSession({ userId, moduleId, reactionTimeMs: 180 });
    const slow = await recordTrainingSession({ userId, moduleId, reactionTimeMs: 600 });
    expect(fast?.score).toBeGreaterThan(slow!.score);
  });

  it("aggregates progress by category with real counts", async () => {
    const progress = await getTrainingProgress(userId);
    expect(progress.totalSessions).toBeGreaterThanOrEqual(2);
    expect(progress.byCategory.REACTION.count).toBeGreaterThanOrEqual(2);
  });
});
