import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  contentToText,
  hasImageContent,
  isSupportedImageMimeType,
  toContentBlocks,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "@/lib/ai/types";
import type { ChatMessageInput } from "@/lib/ai/types";
import { MockAIProvider } from "@/lib/ai/mock";
import { parseQaResponse } from "@/lib/qa/service";
import {
  ALL_QA_CRITERIA,
  CRITERIA_PRESETS,
  dominantFailure,
  QA_FAILURE_KINDS,
  type QaResult,
} from "@/lib/qa/types";
import {
  FAILURE_STRATEGY,
  iterateWithReview,
  strategyFor,
  type AttemptOutput,
} from "@/lib/capabilities/iterate";
import { createArtifact, getArtifact, getLineage, addArtifactVersion } from "@/lib/artifacts/service";
import { signalKindForEvent } from "@/lib/3d/signals";
import { createTestUser } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function qa(overrides: Partial<QaResult> = {}): QaResult {
  return {
    status: "PASS", score: 90, issues: [], recommendations: [],
    criteria: ["overall_quality"], model: "m", provider: "p", durationMs: 1,
    ...overrides,
  };
}

describe("multimodal AIProvider", () => {
  it("keeps the string content form working, unchanged", () => {
    // Widening a type is a change nobody has to react to; replacing one is a
    // change everybody does. Every existing VOX caller passes a string.
    const message: ChatMessageInput = { role: "user", content: "hello" };
    expect(contentToText(message.content)).toBe("hello");
    expect(toContentBlocks(message.content)).toEqual([{ type: "text", text: "hello" }]);
    expect(hasImageContent([message])).toBe(false);
  });

  it("carries text and image blocks together", () => {
    const message: ChatMessageInput = {
      role: "user",
      content: [
        { type: "text", text: "Is this right?" },
        { type: "image", data: PNG_1X1.toString("base64"), mimeType: "image/png" },
        { type: "text", text: "Compare to the brief." },
      ],
    };
    expect(hasImageContent([message])).toBe(true);
    // Text extraction ignores the image rather than stringifying it.
    expect(contentToText(message.content)).toBe("Is this right?\nCompare to the brief.");
  });

  it("allowlists the image types the models actually accept", () => {
    for (const type of SUPPORTED_IMAGE_MIME_TYPES) expect(isSupportedImageMimeType(type)).toBe(true);
    expect(isSupportedImageMimeType("image/tiff")).toBe(false);
    expect(isSupportedImageMimeType("text/html")).toBe(false);
  });

  it("makes the mock provider admit it cannot see", async () => {
    // Load-bearing: Visual QA reads this flag and refuses to run rather than
    // producing a fabricated verdict about an image nothing looked at.
    const mock = new MockAIProvider();
    expect(mock.supportsVision).toBe(false);

    const result = await mock.generate({
      messages: [{ role: "user", content: [
        { type: "text", text: "judge this" },
        { type: "image", data: PNG_1X1.toString("base64"), mimeType: "image/png" },
      ] }],
    });
    expect(result.content).toMatch(/not examined|cannot see/i);
  });
});

describe("Visual QA result parsing", () => {
  const context = { criteria: ALL_QA_CRITERIA.slice(0, 2), model: "m", provider: "p", durationMs: 5, passScore: 70 };

  it("parses a clean pass", () => {
    const result = parseQaResponse('{"status":"PASS","score":88,"issues":[],"recommendations":[]}', context);
    expect(result.status).toBe("PASS");
    expect(result.score).toBe(88);
  });

  it("parses a fail with typed issues", () => {
    const result = parseQaResponse(
      '{"status":"FAIL","score":40,"issues":[{"kind":"MATERIAL_PROBLEM","severity":"MAJOR","description":"reads as armour"}],"recommendations":["say fitted knit"]}',
      context,
    );
    expect(result.status).toBe("FAIL");
    expect(result.issues[0].kind).toBe("MATERIAL_PROBLEM");
    expect(result.recommendations).toEqual(["say fitted knit"]);
  });

  it("overrides a PASS that contradicts its own blocker", () => {
    // A reviewer claiming PASS while reporting a blocker is contradicting
    // itself; trusting the label would approve broken output.
    const result = parseQaResponse(
      '{"status":"PASS","score":95,"issues":[{"kind":"GENERATION_ARTIFACT","severity":"BLOCKER","description":"six fingers"}]}',
      context,
    );
    expect(result.status).toBe("FAIL");
  });

  it("overrides a PASS below the pass score", () => {
    const result = parseQaResponse('{"status":"PASS","score":12,"issues":[]}', context);
    expect(result.status).toBe("FAIL");
  });

  it("reads a fenced JSON response", () => {
    const result = parseQaResponse('```json\n{"status":"PASS","score":80,"issues":[]}\n```', context);
    expect(result.status).toBe("PASS");
  });

  it("treats an unknown issue kind conservatively rather than dropping it", () => {
    const result = parseQaResponse(
      '{"status":"FAIL","score":50,"issues":[{"kind":"WHAT","severity":"NONSENSE","description":"x"}]}',
      context,
    );
    expect(result.issues[0].kind).toBe("GENERATION_ARTIFACT");
    expect(result.issues[0].severity).toBe("MAJOR");
  });

  it("scores a missing score as zero, not as a pass", () => {
    const result = parseQaResponse('{"status":"PASS","issues":[]}', context);
    expect(result.score).toBe(0);
    expect(result.status).toBe("FAIL");
  });

  it("throws on output with no JSON at all", () => {
    expect(() => parseQaResponse("I think it looks quite good, honestly.", context)).toThrow(/No JSON object/);
  });

  it("clamps an out-of-range score", () => {
    expect(parseQaResponse('{"status":"PASS","score":5000,"issues":[]}', context).score).toBe(100);
    expect(parseQaResponse('{"status":"FAIL","score":-40,"issues":[]}', context).score).toBe(0);
  });
});

describe("Visual QA criteria", () => {
  it("gives each task type criteria that actually distinguish it", () => {
    // Applying every criterion to every job invites invented complaints.
    expect(CRITERIA_PRESETS.suit_concept).toContain("material_realism");
    expect(CRITERIA_PRESETS.cinematic_shot).toContain("consistency");
    expect(CRITERIA_PRESETS.cinematic_shot).not.toContain("material_realism");
    expect(CRITERIA_PRESETS.implementation_render).toContain("reference_adherence");
  });

  it("reports the most severe failure, not the first", () => {
    const result = qa({
      status: "FAIL",
      issues: [
        { kind: "COMPOSITION_PROBLEM", severity: "MINOR", description: "a" },
        { kind: "IMPLEMENTATION_PROBLEM", severity: "BLOCKER", description: "b" },
        { kind: "MATERIAL_PROBLEM", severity: "MAJOR", description: "c" },
      ],
    });
    // Fixing three cosmetic complaints while ignoring a hole in the mesh is
    // the wrong order of work.
    expect(dominantFailure(result)).toBe("IMPLEMENTATION_PROBLEM");
  });

  it("reports no failure on a pass", () => {
    expect(dominantFailure(qa())).toBeNull();
  });
});

describe("failure strategy", () => {
  it("decides every failure kind deliberately", () => {
    for (const kind of QA_FAILURE_KINDS) {
      expect(FAILURE_STRATEGY[kind], `${kind} needs a strategy`).toBeTruthy();
    }
  });

  it("does not regenerate for problems regeneration cannot fix", () => {
    // The brief's Phase 7: these are genuinely different situations.
    expect(strategyFor("IMPLEMENTATION_PROBLEM")).toBe("FIX_IMPLEMENTATION");
    expect(strategyFor("MISSING_REQUIREMENT")).toBe("ASK_USER");
    expect(strategyFor("PROVIDER_FAILURE")).toBe("ABORT");
  });

  it("refines the prompt for a mismatch, and resamples for noise", () => {
    expect(strategyFor("REFERENCE_MISMATCH")).toBe("REFINE_PROMPT");
    expect(strategyFor("MATERIAL_PROBLEM")).toBe("REFINE_PROMPT");
    expect(strategyFor("GENERATION_ARTIFACT")).toBe("REGENERATE");
  });
});

describe("bounded iteration", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await createTestUser()).id;
  });

  function output(prompt = "a suit"): AttemptOutput {
    return { data: new Uint8Array(PNG_1X1), mimeType: "image/png", provider: "test", model: "test-1", prompt };
  }

  it("accepts on the first attempt when QA passes", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "First try" });
    const generate = vi.fn(async () => output());
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t1",
      generate, review: async () => qa(),
    });

    expect(result.stop).toBe("ACCEPTED");
    expect(result.attempts).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("iterates after a failure and feeds the review back in", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Second try" });
    const seenFeedback: (string | null)[] = [];

    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t2",
      generate: async (attempt, feedback) => {
        seenFeedback.push(feedback?.kind ?? null);
        return output(`attempt ${attempt}`);
      },
      review: async (_o, attempt) =>
        attempt === 1
          ? qa({ status: "FAIL", score: 40, issues: [{ kind: "MATERIAL_PROBLEM", severity: "MAJOR", description: "armour" }], recommendations: ["say knit"] })
          : qa(),
    });

    expect(result.stop).toBe("ACCEPTED");
    expect(result.attempts).toHaveLength(2);
    // First attempt has no feedback; the second is told what was wrong.
    expect(seenFeedback).toEqual([null, "MATERIAL_PROBLEM"]);
  });

  it("stops at the iteration limit and never loops forever", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Never good" });
    const generate = vi.fn(async () => output());

    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t3",
      maxIterations: 3,
      generate,
      review: async () => qa({ status: "FAIL", score: 30, issues: [{ kind: "REFERENCE_MISMATCH", severity: "MAJOR", description: "off" }] }),
    });

    expect(result.stop).toBe("ITERATION_LIMIT");
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("persists every attempt, including rejected ones", async () => {
    // Discarding failures would show three clean successes where there was
    // one success and two rejections.
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "History" });
    await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t4",
      maxIterations: 3,
      generate: async () => output(),
      review: async (_o, attempt) => (attempt < 3 ? qa({ status: "FAIL", score: 20, issues: [{ kind: "GENERATION_ARTIFACT", severity: "MAJOR", description: "smear" }] }) : qa()),
    });

    const stored = await getArtifact(userId, artifact.id);
    expect(stored?.versions).toHaveLength(3);
    // Append-only: version numbers are sequential and none was overwritten.
    expect(stored?.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("stops immediately when regeneration cannot help", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Code bug" });
    const generate = vi.fn(async () => output());

    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t5",
      maxIterations: 3,
      generate,
      review: async () => qa({ status: "FAIL", score: 20, issues: [{ kind: "IMPLEMENTATION_PROBLEM", severity: "BLOCKER", description: "the bay renders the old mesh" }] }),
    });

    // One attempt, not three: no amount of regenerating fixes a code bug.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.reason).toMatch(/implementation/i);
  });

  it("stops rather than guessing when a requirement is missing", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Underspecified" });
    const generate = vi.fn(async () => output());

    await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t6",
      maxIterations: 3, generate,
      review: async () => qa({ status: "FAIL", score: 30, issues: [{ kind: "MISSING_REQUIREMENT", severity: "MAJOR", description: "no colourway given" }] }),
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("refuses to start an attempt the budget will not allow", async () => {
    const artifact = await createArtifact({ userId, kind: "VIDEO", label: "Too expensive" });
    const generate = vi.fn(async () => output());

    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "VIDEO_GENERATION", traceId: "t7",
      // Zero allowance: the check must happen BEFORE the call, or it already
      // cost something.
      budget: { dailyCalls: { VIDEO_GENERATION: 0 } },
      generate, review: async () => qa(),
    });

    expect(result.stop).toBe("BUDGET");
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves state when generation throws", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Broken provider" });
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t8",
      generate: async () => { throw new Error("provider exploded"); },
      review: async () => qa(),
    });

    expect(result.stop).toBe("GENERATION_FAILED");
    expect(result.reason).toContain("provider exploded");
    // No artifact version was written for a generation that produced nothing.
    expect((await getArtifact(userId, artifact.id))?.versions).toHaveLength(0);
  });

  it("treats an unavailable reviewer as a stop, never as a pass", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "No reviewer" });
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t9",
      generate: async () => output(),
      review: async () => { throw new Error("no vision provider"); },
    });

    expect(result.stop).toBe("REVIEW_UNAVAILABLE");
    expect(result.attempts[0].accepted).toBe(false);
  });

  it("accepts the first result when no review was requested", async () => {
    // Looping without a way to tell better from worse is spending at random.
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Unreviewed" });
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t10",
      generate: async () => output(),
    });
    expect(result.stop).toBe("ACCEPTED");
    expect(result.attempts[0].qa).toBeNull();
  });

  it("keeps lineage on every iteration", async () => {
    const reference = await createArtifact({ userId, kind: "IMAGE", label: "Reference" });
    const referenceVersion = await addArtifactVersion({
      userId, artifactId: reference.id, data: new Uint8Array(PNG_1X1), mimeType: "image/png",
    });

    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Derived" });
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t11",
      derivedFrom: [{ versionId: referenceVersion.id, role: "reference" }],
      generate: async () => output(),
      review: async () => qa(),
    });

    const lineage = await getLineage(userId, result.best!.versionId);
    expect(lineage.map((n) => n.artifactLabel)).toContain("Reference");
  });

  it("reports the best attempt even when none passed", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Best effort" });
    const result = await iterateWithReview({
      userId, artifactId: artifact.id, capability: "IMAGE_GENERATION", traceId: "t12",
      maxIterations: 3,
      generate: async () => output(),
      review: async (_o, attempt) => qa({ status: "FAIL", score: attempt === 2 ? 65 : 20, issues: [{ kind: "REFERENCE_MISMATCH", severity: "MAJOR", description: "x" }] }),
    });

    expect(result.stop).toBe("ITERATION_LIMIT");
    expect(result.best?.qa?.score).toBe(65);
  });
});

describe("new event classification", () => {
  it("treats file changes and validations as execution", () => {
    expect(signalKindForEvent("execution.file_changed")).toBe("execution");
    expect(signalKindForEvent("execution.validation_passed")).toBe("execution");
    expect(signalKindForEvent("execution.validation_failed")).toBe("execution");
  });

  it("treats an iteration verdict as reasoning", () => {
    expect(signalKindForEvent("iteration.completed")).toBe("reasoning");
    expect(signalKindForEvent("qa.completed")).toBe("reasoning");
  });

  it("keeps non-events out of the Brain's signal", () => {
    // A review that could not run produced no judgement to report.
    expect(signalKindForEvent("qa.failed")).toBeNull();
    expect(signalKindForEvent("iteration.failed")).toBeNull();
  });
});
