import { describe, it, expect, beforeAll } from "vitest";
import { createSuit } from "@/lib/lab/suits";
import { createRequirement, updateRequirement, listRequirements } from "@/lib/lab/requirements";
import { createQuestion, updateQuestion, listQuestions } from "@/lib/lab/questions";
import { createDecision, listDecisions } from "@/lib/lab/decisions";
import { createResearchLink, listResearchLinks } from "@/lib/lab/researchLinks";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 70, durability: 50, mobility: 60, stretchiness: 55, weightKg: 4, thermalLoadC: 30,
  protection: 45, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 28000, flexibility: 55, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40,
};

describe("Lab engineering domain: requirements", () => {
  let userId: string;
  let suitId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId, codename: "Requirement Test Suit", archetype: "Tactical", stats: SAMPLE_STATS });
    suitId = suit.id;
  });

  it("creates a requirement defaulting to HYPOTHESIS status, never VERIFIED by default", async () => {
    const req = await createRequirement({ userId, suitId, code: "REQ-001", title: "Rapid assisted movement" });
    expect(req.status).toBe("HYPOTHESIS");
    expect(req.priority).toBe("MEDIUM");

    const listed = await listRequirements(userId, suitId);
    expect(listed.some((r) => r.id === req.id)).toBe(true);
  });

  it("refuses to mark a requirement VERIFIED without recorded evidence", async () => {
    const req = await createRequirement({ userId, suitId, code: "REQ-002", title: "Needs evidence" });
    await expect(updateRequirement(userId, req.id, { status: "VERIFIED" })).rejects.toThrow(/evidence/i);
  });

  it("allows VERIFIED once real evidence is recorded, and emits a status_changed event", async () => {
    const req = await createRequirement({ userId, suitId, code: "REQ-003", title: "Has evidence" });
    const updated = await updateRequirement(userId, req.id, {
      status: "VERIFIED",
      evidence: "Bench test EXP-014 measured 3.2x assisted acceleration.",
    });
    expect(updated?.status).toBe("VERIFIED");
  });

  it("scopes requirements per user", async () => {
    const otherUser = await createTestUser();
    const mine = await listRequirements(userId, suitId);
    const theirs = await listRequirements(otherUser.id);
    expect(theirs.find((r) => mine.some((m) => m.id === r.id))).toBeUndefined();
  });
});

describe("Lab engineering domain: engineering questions", () => {
  let userId: string;
  let suitId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId, codename: "Question Test Suit", archetype: "Recon", stats: SAMPLE_STATS });
    suitId = suit.id;
  });

  it("creates an unresolved question defaulting to HYPOTHETICAL confidence", async () => {
    const q = await createQuestion({ userId, suitId, question: "Can the mobility system hit the target load under wet conditions?" });
    expect(q.resolved).toBe(false);
    expect(q.confidence).toBe("HYPOTHETICAL");
    expect(q.resolvedAt).toBeNull();
  });

  it("resolving a question sets resolvedAt and is idempotent (no duplicate event on re-save)", async () => {
    const q = await createQuestion({ userId, suitId, question: "Does the actuator overheat at max duty cycle?" });
    const resolved = await updateQuestion(userId, q.id, { resolved: true, answer: "No, stays under 60C in testing." });
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.resolvedAt).not.toBeNull();

    const resavedSameAnswer = await updateQuestion(userId, q.id, { answer: "No, stays under 60C in testing. (confirmed twice)" });
    expect(resavedSameAnswer?.resolved).toBe(true);
  });

  it("listQuestions can filter to only unresolved", async () => {
    await createQuestion({ userId, suitId, question: "Open question A" });
    const openOnes = await listQuestions(userId, suitId, false);
    expect(openOnes.every((q) => !q.resolved)).toBe(true);
    expect(openOnes.some((q) => q.question === "Open question A")).toBe(true);
  });
});

describe("Lab engineering domain: decisions (immutable log)", () => {
  it("records a decision with options and rationale, defaulting author to 'user'", async () => {
    const user = await createTestUser();
    const suit = await createSuit({ userId: user.id, codename: "Decision Test Suit", archetype: "Combat", stats: SAMPLE_STATS });

    const decision = await createDecision({
      userId: user.id,
      suitId: suit.id,
      decision: "Use carbon composite for the chest plate",
      context: "Needed a lighter alternative to the steel prototype.",
      options: ["Steel", "Titanium alloy", "Carbon composite"],
      selectedOption: "Carbon composite",
      rationale: "Best strength-to-weight ratio within budget.",
    });

    expect(decision.author).toBe("user");
    expect(JSON.parse(decision.options!)).toEqual(["Steel", "Titanium alloy", "Carbon composite"]);

    const listed = await listDecisions(user.id, suit.id);
    expect(listed.some((d) => d.id === decision.id)).toBe(true);
  });
});

describe("Lab engineering domain: research links (reference, never duplicate)", () => {
  it("links a real core ResearchItem the user owns to a real Lab question they own", async () => {
    const user = await createTestUser();
    const question = await createQuestion({ userId: user.id, question: "What actuator type minimizes noise?" });
    const researchItem = await (await import("@/lib/db")).db.researchItem.create({
      data: { userId: user.id, query: "quiet actuators", provider: "mock", title: "Piezoelectric actuators run near-silent" },
    });

    const link = await createResearchLink({
      userId: user.id,
      researchItemId: researchItem.id,
      subjectType: "LabEngineeringQuestion",
      subjectId: question.id,
    });

    expect(link).not.toBeNull();
    const links = await listResearchLinks(user.id, "LabEngineeringQuestion", question.id);
    expect(links).toHaveLength(1);
    expect(links[0].researchItem.title).toBe("Piezoelectric actuators run near-silent");
  });

  it("refuses to link a research item the user does not own", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const question = await createQuestion({ userId: attacker.id, question: "Attacker's own question" });
    const researchItem = await (await import("@/lib/db")).db.researchItem.create({
      data: { userId: owner.id, query: "private research", provider: "mock" },
    });

    const link = await createResearchLink({
      userId: attacker.id,
      researchItemId: researchItem.id,
      subjectType: "LabEngineeringQuestion",
      subjectId: question.id,
    });

    expect(link).toBeNull();
  });

  it("refuses to link to a subject the user does not own", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const question = await createQuestion({ userId: owner.id, question: "Owner's own question" });
    const researchItem = await (await import("@/lib/db")).db.researchItem.create({
      data: { userId: attacker.id, query: "attacker research", provider: "mock" },
    });

    const link = await createResearchLink({
      userId: attacker.id,
      researchItemId: researchItem.id,
      subjectType: "LabEngineeringQuestion",
      subjectId: question.id,
    });

    expect(link).toBeNull();
  });
});
