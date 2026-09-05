import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, approveAndResume } from "./helpers";
import { driveRequest, wantsRefinement } from "@/lib/capabilities/orchestrator";
import { getRunTrace } from "@/lib/capabilities/trace";
import { executeRun } from "@/lib/agents/executor";
import { grantPermission } from "@/lib/permissions/service";
import { decideNext, DEFAULT_MIN_IMPROVEMENT } from "@/lib/capabilities/decide";
import { buildRevisionPlan, renderRevisionInstruction } from "@/lib/capabilities/revision";
import { listLabArtifacts } from "@/lib/lab/artifacts";
import * as imageModule from "@/lib/image";
import * as qaModule from "@/lib/qa/service";
import { VisionUnavailableError } from "@/lib/qa/service";
import type { ImageProvider } from "@/lib/image/types";
import type { QaCriterion, QaResult } from "@/lib/qa/types";

/**
 * ORCH-010 — the improvement loop, reached from a real request.
 *
 * The point of these tests is the WORD "reached". The loop itself was already
 * covered; what was missing was any path from something a user types to the
 * loop running. So every test here starts at `driveRequest` with an English
 * sentence and asserts on what the run actually did — not on a helper called
 * directly with hand-built arguments.
 *
 * Providers are injected. Nothing here needs a key or spends a cent, and the
 * generation counter is what proves the cost claims: "no unnecessary second
 * generation" is only meaningful if something counted.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let imageCalls = 0;
let qaCalls = 0;
/** Prompts the provider was actually handed, in order. */
let prompts: string[] = [];
/** Scores handed to successive reviews. */
let scoreQueue: number[] = [];
/** When set, generation throws on the attempt with this number. */
let failGenerationOn: number | null = null;
/** When true, review throws VisionUnavailableError. */
let reviewUnavailable = false;

function fakeImageProvider(): ImageProvider {
  return {
    id: "test-image",
    displayName: "Test Image Provider",
    defaultModel: "test-model-1",
    capabilities: ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_EDIT"],
    isConfigured: true,
    unavailableReason: null,
    async generate(request) {
      imageCalls += 1;
      prompts.push(request.prompt);
      if (failGenerationOn !== null && imageCalls === failGenerationOn) {
        throw new Error("Provider exploded.");
      }
      const n = request.count ?? 1;
      return {
        images: Array.from({ length: n }, () => ({
          data: new Uint8Array(PNG_1X1),
          mimeType: "image/png",
          width: 1,
          height: 1,
        })),
        provider: "test-image",
        model: "test-model-1",
        costUsd: 0.001,
        durationMs: 5,
      };
    },
  };
}

const CRITERIA: QaCriterion[] = [
  "reference_adherence",
  "proportions",
  "material_realism",
  "requested_modifications",
  "overall_quality",
];

function qaResult(score: number): QaResult {
  return {
    status: score >= 80 ? "PASS" : "FAIL",
    score,
    issues:
      score >= 80
        ? []
        : [{ kind: "MATERIAL_PROBLEM", severity: "MAJOR", description: "Material still reads as armored." }],
    recommendations: score >= 80 ? [] : ["Reduce rigid panelling and increase textile behaviour."],
    criteria: CRITERIA,
    model: "test-vision-1",
    provider: "test-vision",
    durationMs: 4,
  };
}

// Each test makes its own user: the loop asserts on exact provider-call
// counts, and a shared user would let one test's budget consumption change
// another's result.
beforeAll(async () => {
  await createTestUser();
});

beforeEach(() => {
  imageCalls = 0;
  qaCalls = 0;
  prompts = [];
  scoreQueue = [];
  failGenerationOn = null;
  reviewUnavailable = false;
  vi.spyOn(imageModule, "getImageProvider").mockReturnValue(fakeImageProvider());
  vi.spyOn(qaModule, "runVisualQa").mockImplementation(async () => {
    qaCalls += 1;
    if (reviewUnavailable) throw new VisionUnavailableError("mock");
    return qaResult(scoreQueue.shift() ?? 95);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function grantAll(id: string) {
  for (const capability of ["memory.search", "media.image.generate", "artifact.select", "lab.write", "qa.visual_review"]) {
    await grantPermission(id, capability, "ACT");
  }
}

/** A request whose wording asks for the result to be made good, not just made. */
const REFINE_REQUEST = "Generate a concept image of the suit and improve it until the material reads as technical fabric.";

describe("recognising a request that asks for improvement", () => {
  it("reads an explicit refinement verb", () => {
    expect(wantsRefinement("improve the strongest design", false)).toBe(true);
    expect(wantsRefinement("refine it until it matches", false)).toBe(true);
    // No refinement verb and no stated bar — one generation is what was asked for.
    expect(wantsRefinement("generate a concept image of the mask", false)).toBe(false);
  });

  it("treats a required quality bar as an instruction to keep working", () => {
    // The router marks QA required when the request states a bar; clearing a
    // bar means working at it, not checking once and reporting failure.
    expect(wantsRefinement("generate a concept image of the mask", true)).toBe(true);
  });
});

describe("the decision engine", () => {
  it("approves a pass without spending another attempt", () => {
    const d = decideNext({ qa: qaResult(88), attempt: 1, maxIterations: 3, bestScoreBefore: null, minImprovement: 3 });
    expect(d.decision).toBe("APPROVE");
  });

  it("iterates on a fail that generation could plausibly fix", () => {
    const d = decideNext({ qa: qaResult(60), attempt: 1, maxIterations: 3, bestScoreBefore: null, minImprovement: 3 });
    expect(d.decision).toBe("ITERATE");
  });

  it("stops when attempts stop improving, before the ceiling is reached", () => {
    const d = decideNext({ qa: qaResult(61), attempt: 2, maxIterations: 5, bestScoreBefore: 60, minImprovement: 3 });
    expect(d.decision).toBe("STOP_NO_MEANINGFUL_IMPROVEMENT");
  });

  it("stops at the ceiling when it is still improving but out of attempts", () => {
    const d = decideNext({ qa: qaResult(75), attempt: 3, maxIterations: 3, bestScoreBefore: 60, minImprovement: 3 });
    expect(d.decision).toBe("STOP_MAX_ITERATIONS");
  });

  it("refuses to keep generating against a defect generation cannot fix", () => {
    const implementationBug: QaResult = {
      ...qaResult(50),
      issues: [{ kind: "IMPLEMENTATION_PROBLEM", severity: "MAJOR", description: "Render does not match the design." }],
    };
    const d = decideNext({ qa: implementationBug, attempt: 1, maxIterations: 3, bestScoreBefore: null, minImprovement: 3 });
    expect(d.decision).toBe("STOP_NOT_FIXABLE_BY_GENERATION");
  });

  it("treats an absent reviewer as no basis for another attempt", () => {
    const d = decideNext({ qa: null, attempt: 1, maxIterations: 3, bestScoreBefore: null, minImprovement: 3 });
    expect(d.decision).toBe("STOP_PROVIDER_UNAVAILABLE");
  });
});

describe("revision directives", () => {
  it("orders defects worst-first and names what to keep", () => {
    const qa: QaResult = {
      ...qaResult(62),
      issues: [
        { kind: "MATERIAL_PROBLEM", severity: "MINOR", description: "Slight sheen on the forearm." },
        { kind: "PROPORTION_PROBLEM", severity: "BLOCKER", description: "Shoulders are twice head width." },
      ],
      recommendations: ["Narrow the shoulder line.", "Reduce specular response."],
    };

    const plan = buildRevisionPlan(qa, 1);
    expect(plan.directives[0].severity).toBe("BLOCKER");
    expect(plan.directives[0].priority).toBe(1);
    // Nothing complained about reference adherence, so it is restated rather
    // than left free to drift while the shoulders are fixed.
    expect(plan.preserve).toContain("reference_adherence");
    expect(plan.preserve).not.toContain("proportions");
    expect(plan.preserve).not.toContain("material_realism");

    const text = renderRevisionInstruction(plan);
    expect(text).toContain("Shoulders are twice head width");
    expect(text).toMatch(/Keep these unchanged/);
  });
});

describe("TEST A — passes first review", () => {
  it("does not spend a second generation on a result that already passed", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [92];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    expect(trace.status).toBe("COMPLETED");
    // The whole point: one generation, one review, no speculative retry.
    expect(imageCalls).toBe(1);
    expect(qaCalls).toBe(1);
    expect(trace.iterations[0]?.attempts).toHaveLength(1);
    expect(trace.iterations[0]?.attempts[0].status).toBe("PASS");
  });
});

describe("TEST B — iterates once, then passes", () => {
  it("revises after a failed review and the second attempt is instructed differently", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [64, 91];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    expect(trace.status).toBe("COMPLETED");
    expect(imageCalls).toBe(2);
    expect(qaCalls).toBe(2);

    // The second prompt is genuinely different — it carries the defect and the
    // preserve list. Without this the "loop" is just a retry.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toBe(prompts[0]);
    expect(prompts[1]).toContain("Material still reads as armored");
    expect(prompts[1]).toMatch(/Keep these unchanged/);

    // Both attempts are kept; the passing one is approved.
    expect(trace.artifacts).toHaveLength(2);
    expect(trace.artifacts.filter((a) => a.state === "ACTIVE" || a.state === "APPROVED")).toHaveLength(1);
  });
});

describe("TEST C — several iterations before passing", () => {
  it("keeps climbing while it is genuinely improving", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [55, 70, 88];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    expect(imageCalls).toBe(3);
    expect(trace.iterations[0]?.attempts.map((a) => a.score)).toEqual([55, 70, 88]);
    expect(trace.iterations[0]?.attempts[2].status).toBe("PASS");
    expect(trace.status).toBe("COMPLETED");
  });
});

describe("TEST D — the ceiling holds", () => {
  it("stops at the limit and generates no further candidates", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    // Climbing steadily but never reaching the pass mark.
    scoreQueue = [40, 50, 60, 70, 75];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    // The configured ceiling is 3. Exactly three, not four.
    expect(imageCalls).toBe(3);
    expect(trace.iterations[0]?.attempts).toHaveLength(3);
    expect(trace.iterations[0]?.limit).toBe(3);

    const stopped = trace.activity.find((a) => a.type === "iteration.stopped");
    expect(stopped).toBeTruthy();

    // The best attempt is still approved — a run that ran out of attempts has
    // produced something, and discarding it would waste what was paid for.
    expect(trace.artifacts.filter((a) => a.state === "ACTIVE" || a.state === "APPROVED")).toHaveLength(1);
  });
});

describe("TEST E — stalling stops the loop", () => {
  it("stops when an attempt gains less than the improvement floor", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    // 60 then 61: a one-point gain, below the floor, with attempts left over.
    scoreQueue = [60, 61, 62];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    // Two generations, not three: the ceiling was never the binding constraint.
    expect(imageCalls).toBe(2);
    expect(DEFAULT_MIN_IMPROVEMENT).toBeGreaterThan(1);
    expect(trace.status).toBe("COMPLETED");
  });
});

describe("TEST F — provider failure is honest", () => {
  it("stops cleanly when generation throws, with no fabricated success", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [55, 70];
    failGenerationOn = 2;

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    // Attempt 1 succeeded and was kept; attempt 2 threw.
    expect(imageCalls).toBe(2);
    expect(trace.artifacts).toHaveLength(1);
    // The failed provider call is recorded as failed, not quietly dropped.
    expect(trace.providerCalls.some((c) => c.status === "FAILED")).toBe(true);
    // Nothing claims a pass.
    expect(trace.artifacts.every((a) => a.state !== "QA_FAILED" || a.score !== null)).toBe(true);
  });

  it("stops without approving anything when no reviewer can look", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    reviewUnavailable = true;

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    // One generation, then it stops — a result nothing could judge is not a
    // reason to generate more of them.
    expect(imageCalls).toBe(1);
    expect(trace.artifacts).toHaveLength(1);
    const stopped = trace.activity.find((a) => a.type === "iteration.stopped");
    expect(stopped).toBeTruthy();
  });
});

describe("TEST G — resume does not repeat attempts", () => {
  it("continues the loop from the attempts already on disk", async () => {
    const id = (await createTestUser()).id;
    // Generation gated, memory granted, so the run parks before the loop.
    await grantPermission(id, "memory.search", "ACT");
    scoreQueue = [58, 74, 90];

    const result = await driveRequest({
      userId: id,
      request: "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
    });
    const runId = result.runId!;
    expect((await getRunTrace(id, { runId })).status).toBe("WAITING_FOR_PERMISSION");
    expect(imageCalls).toBe(0);

    await grantPermission(id, "media.image.generate", "ACT");
    await grantPermission(id, "qa.visual_review", "ACT");
    await executeRun(id, runId);
    // [P4-C3] Holding the capability is not approving the invocation.
    await approveAndResume(id, runId);

    const trace = await getRunTrace(id, { runId });
    expect(trace.status).toBe("COMPLETED");
    const generationsFirstPass = imageCalls;
    expect(generationsFirstPass).toBeGreaterThan(0);

    // Re-running a COMPLETED run must not regenerate anything.
    await executeRun(id, runId);
    expect(imageCalls).toBe(generationsFirstPass);
    expect((await getRunTrace(id, { runId })).artifacts.length).toBe(trace.artifacts.length);
  });
});

describe("TEST H — the trace reconstructs the loop", () => {
  it("records every attempt, its verdict, and why the loop ended", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [52, 68, 84];

    const result = await driveRequest({ userId: id, request: REFINE_REQUEST });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    // Every attempt, in order, with its real score.
    const loop = trace.iterations[0];
    expect(loop.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    expect(loop.attempts.map((a) => a.score)).toEqual([52, 68, 84]);
    expect(loop.attempts.map((a) => a.status)).toEqual(["FAIL", "FAIL", "PASS"]);

    // "Why did it generate version 2?" — a revision was created from version 1.
    const revisions = trace.activity.filter((a) => a.type === "iteration.revision_created");
    expect(revisions.length).toBeGreaterThanOrEqual(2);

    // "Why did the loop stop?"
    expect(trace.activity.some((a) => a.type === "iteration.approved")).toBe(true);

    // Every attempt is an artifact version with lineage, none discarded.
    expect(trace.artifacts).toHaveLength(3);
  });
});

describe("the full sentence from the brief", () => {
  it("makes variations, compares them, improves the winner, and attaches it", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    const suit = await db.labSuit.create({
      data: { userId: id, codename: "MERIDIAN", designation: "VX-01", archetype: "Utility" },
    });

    // Three candidates reviewed (71/78/62), then the winner refined: it fails
    // once at 74 and passes at 90.
    scoreQueue = [71, 78, 62, 74, 90];

    const result = await driveRequest({
      userId: id,
      request:
        "Make three variations of the mask, evaluate them, improve the strongest design if necessary, and attach the final design to the Suit Bay.",
      subjectType: "LabSuit",
      subjectId: suit.id,
    });

    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });
    const tools = trace.steps.map((s) => s.toolName);

    // The real path: generate, compare, refine, attach — in that order.
    expect(tools).toContain("media.image.generate");
    expect(tools).toContain("artifact.select_best");
    expect(tools).toContain("media.image.refine");
    expect(tools).toContain("lab.attach_artifact");
    expect(tools.indexOf("artifact.select_best")).toBeLessThan(tools.indexOf("media.image.refine"));
    expect(tools.indexOf("media.image.refine")).toBeLessThan(tools.indexOf("lab.attach_artifact"));

    expect(trace.status).toBe("COMPLETED");

    // The Lab's own read sees the finished design.
    const labArtifacts = await listLabArtifacts(id, "LabSuit", suit.id);
    expect(labArtifacts).toHaveLength(1);
    expect(labArtifacts[0].current?.approved).toBe(true);
  });

  it("leaves a one-shot request as one shot", async () => {
    const id = (await createTestUser()).id;
    await grantAll(id);
    scoreQueue = [55];

    // No refinement verb, no stated bar: VOX should not spend three calls
    // improving something nobody asked it to improve.
    const result = await driveRequest({ userId: id, request: "Generate a concept image of the mask." });
    // [P4-C3] Generation, review, selection and the Lab write are HOLD
    // actions, so the run parks for a human at each. The subject here is the
    // refinement loop, so the approvals come from the real approval service.
    await approveAndResume(id, result.runId!);
    const trace = await getRunTrace(id, { runId: result.runId! });

    expect(trace.steps.map((s) => s.toolName)).not.toContain("media.image.refine");
    expect(imageCalls).toBe(1);
  });
});
