import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createObservation, listObservations, createHypothesis, updateHypothesisStatus } from "@/lib/cognition/service";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { detectPatterns, listPatterns } from "@/lib/cognition/patterns";
import { createTestUser } from "./helpers";

describe("cognitive observations", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates an observation defaulting to LOW confidence", async () => {
    const observation = await createObservation({
      userId,
      dimension: "FOCUS",
      content: "Stayed on one task for 3 hours without switching.",
    });
    expect(observation.confidence).toBe("LOW");
    expect(observation.dimension).toBe("FOCUS");
  });

  it("lists observations filtered by dimension", async () => {
    await createObservation({ userId, dimension: "CREATIVITY", content: "Generated 5 new ideas in one session." });
    const focusOnly = await listObservations(userId, "FOCUS");
    expect(focusOnly.every((o) => o.dimension === "FOCUS")).toBe(true);
  });

  it("hypotheses start OPEN and can move to SUPPORTED/REJECTED without becoming silent facts", async () => {
    const hypothesis = await createHypothesis({ userId, statement: "User works in longer focused blocks in the morning." });
    expect(hypothesis.status).toBe("OPEN");
    expect(hypothesis.confidence).toBe("LOW");

    const updated = await updateHypothesisStatus(userId, hypothesis.id, "SUPPORTED", "MEDIUM");
    expect(updated?.status).toBe("SUPPORTED");
    expect(updated?.confidence).toBe("MEDIUM");
  });

  it("cognitive profile reports explicit 'no data' for dimensions with zero observations", async () => {
    const freshUser = await createTestUser();
    const profile = await getCognitiveProfile(freshUser.id);
    expect(profile).toHaveLength(12);
    expect(profile.every((d) => d.hasData === false)).toBe(true);
    expect(profile.every((d) => d.observationCount === 0)).toBe(true);
  });

  it("cognitive profile separates observed volume from inferred estimate/trend once data exists", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 4; i++) {
      await createObservation({ userId: user.id, dimension: "PLANNING_BEHAVIOR", content: `Observation ${i}` });
    }
    const profile = await getCognitiveProfile(user.id);
    const planning = profile.find((d) => d.dimension === "PLANNING_BEHAVIOR");
    expect(planning?.hasData).toBe(true);
    expect(planning?.observationCount).toBe(4);
    expect(planning?.confidence).toBe("MEDIUM"); // derived from volume, not fabricated
    expect(planning?.estimate).toBeTruthy();
  });

  it("detects an idea-without-execution pattern from stale captured ideas", async () => {
    const user = await createTestUser();
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      const idea = await db.idea.create({ data: { userId: user.id, title: `Stale idea ${i}`, status: "CAPTURED" } });
      await db.idea.update({ where: { id: idea.id }, data: { createdAt: oldDate } });
    }

    const detected = await detectPatterns(user.id);
    expect(detected.some((p) => p.type === "IDEA_WITHOUT_EXECUTION")).toBe(true);

    const patterns = await listPatterns(user.id);
    expect(patterns.some((p) => p.type === "IDEA_WITHOUT_EXECUTION" && p.confidence === "LOW")).toBe(true);
  });

  it("does not detect a pattern when there isn't enough evidence", async () => {
    const user = await createTestUser();
    const detected = await detectPatterns(user.id);
    expect(detected).toHaveLength(0);
  });
});
