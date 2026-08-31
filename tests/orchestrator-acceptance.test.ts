import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "./helpers";
import { driveRequest, resumeRun, cancelRun, requestedVariations } from "@/lib/capabilities/orchestrator";
import { getRunTrace } from "@/lib/capabilities/trace";
import { executeRun } from "@/lib/agents/executor";
import { iterateWithReview } from "@/lib/capabilities/iterate";
import { grantPermission } from "@/lib/permissions/service";
import { createArtifact } from "@/lib/artifacts/service";
import { listLabArtifacts } from "@/lib/lab/artifacts";
import * as imageModule from "@/lib/image";
import * as qaModule from "@/lib/qa/service";
import type { ImageProvider } from "@/lib/image/types";
import type { QaResult } from "@/lib/qa/types";

/**
 * End-to-end acceptance for the orchestrator.
 *
 * Providers are INJECTED, never live: these tests must be runnable by anyone,
 * on any machine, without a key or a cent of spend. What is deliberately NOT
 * faked is everything between the orchestrator and the provider — the real
 * router, the real AgentRun/AgentStep persistence, the real executor, the real
 * checkCapability() gate, the real artifact and lineage writes. A test that
 * stubbed those would prove only that the stubs agree with each other.
 */

/** The smallest real PNG: 1×1, so `readImageDimensions` gets true bytes. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userId: string;
let suitId: string;

/** Counts real provider invocations, so "no further calls" can be asserted. */
let imageCalls = 0;
let qaCalls = 0;
/** Scores handed to successive reviews, so a test can script PASS/FAIL. */
let scoreQueue: number[] = [];

function fakeImageProvider(count = 3): ImageProvider {
  return {
    id: "test-image",
    displayName: "Test Image Provider",
    defaultModel: "test-model-1",
    capabilities: ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_EDIT"],
    isConfigured: true,
    unavailableReason: null,
    async generate(request) {
      imageCalls += 1;
      const n = request.count ?? count;
      return {
        images: Array.from({ length: n }, () => ({ data: new Uint8Array(PNG_1X1), mimeType: "image/png", width: 1, height: 1 })),
        provider: "test-image",
        model: "test-model-1",
        costUsd: 0.001,
        durationMs: 12,
      };
    },
  };
}

function qaResult(score: number): QaResult {
  return {
    status: score >= 80 ? "PASS" : "FAIL",
    score,
    issues:
      score >= 80
        ? []
        : [{ kind: "MATERIAL_PROBLEM", severity: "MAJOR", description: "Material still reads as armored." }],
    recommendations: score >= 80 ? [] : ["Emphasise woven fabric over plating."],
    model: "test-vision-1",
  } as QaResult;
}

beforeAll(async () => {
  userId = (await createTestUser()).id;
  const suit = await db.labSuit.create({
    data: { userId, codename: "MERIDIAN", designation: "VX-01", archetype: "Utility" },
  });
  suitId = suit.id;
});

beforeEach(() => {
  imageCalls = 0;
  qaCalls = 0;
  scoreQueue = [];
  vi.spyOn(imageModule, "getImageProvider").mockReturnValue(fakeImageProvider());
  vi.spyOn(qaModule, "runVisualQa").mockImplementation(async () => {
    qaCalls += 1;
    return qaResult(scoreQueue.shift() ?? 90);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything the orchestrated steps need, so a run is not testing the gate. */
async function grantEverything() {
  for (const capability of ["memory.search", "media.image.generate", "artifact.select", "lab.write", "qa.visual_review"]) {
    await grantPermission(userId, capability, "ACT");
  }
}

describe("reading how many variations were asked for", () => {
  it("takes a count only when it is attached to a variation noun", () => {
    expect(requestedVariations("Create three suit concepts")).toBe(3);
    expect(requestedVariations("make 4 variations of the mask")).toBe(4);
    // "Three" here is part of a NAME. Generating three images from it would be
    // spending money on a misreading.
    expect(requestedVariations("Render the Mark Three suit")).toBe(1);
    expect(requestedVariations("Generate a concept")).toBe(1);
  });

  it("caps the count, so a typo cannot order fifty provider calls", () => {
    expect(requestedVariations("give me 50 variations")).toBe(6);
  });
});

describe("acceptance 1 — concepts, comparison, selection, Lab", () => {
  it("runs the whole workflow and leaves a trace that reconstructs it", async () => {
    await grantEverything();
    // Candidates score 71, 78, 94 — so the winner is genuinely chosen, not
    // simply the last one generated.
    scoreQueue = [71, 78, 94];

    const result = await driveRequest({
      userId,
      request: "Create three suit concepts, compare them, select the strongest, then build it into the Suit Bay.",
      subjectType: "LabSuit",
      subjectId: suitId,
    });

    expect(result.runId).toBeTruthy();
    const trace = await getRunTrace(userId, { runId: result.runId! });

    // 4. AgentRun persists, 5. steps persist.
    expect(trace.runId).toBe(result.runId);
    expect(trace.steps.length).toBeGreaterThan(0);
    // 14. the trace carries the plan that produced those steps.
    expect(trace.plan?.steps.some((s) => s.capability === "IMAGE_GENERATION")).toBe(true);

    // 6/7. Generation ran once and produced three candidates.
    expect(imageCalls).toBe(1);
    expect(trace.artifacts.length).toBe(3);

    // 8. Every candidate was judged — not just the winner.
    expect(qaCalls).toBe(3);
    expect(trace.reviews.map((r) => r.score).sort((a, b) => a - b)).toEqual([71, 78, 94]);

    // 9. The strongest was selected and approved, and it is the 94 not the last.
    const active = trace.artifacts.filter((a) => a.state === "ACTIVE" || a.state === "APPROVED");
    expect(active).toHaveLength(1);
    expect(active[0].score).toBe(94);
    // The rejected candidates are kept, marked as what they are.
    expect(trace.artifacts.filter((a) => a.state === "QA_FAILED")).toHaveLength(2);

    // 13. The run completed.
    expect(trace.status).toBe("COMPLETED");

    // 15. The Lab now references the approved artifact. Asserted through the
    // Lab's OWN read rather than a raw query, because that is the code path
    // the Suit Bay actually uses — a direct row check would pass even if the
    // Lab could not see it.
    const labArtifacts = await listLabArtifacts(userId, "LabSuit", suitId);
    expect(labArtifacts).toHaveLength(1);
    expect(labArtifacts[0].current?.approved).toBe(true);

    // 16. Enough for the UI to reconstruct: activity, cost and providers.
    expect(trace.activity.length).toBeGreaterThan(0);
    expect(trace.providerCalls.length).toBeGreaterThan(0);
    expect(trace.costUsd).toBeGreaterThan(0);
  });
});

describe("acceptance 2 — permission pause and resume", () => {
  it("pauses without the grant, exposes it, then resumes without repeating work", async () => {
    const gated = (await createTestUser()).id;
    // Deliberately NOT granting media.image.generate: the run must stop there.
    await grantPermission(gated, "memory.search", "ACT");
    scoreQueue = [95];

    const result = await driveRequest({
      userId: gated,
      // Names a subject the router recalls for ("suit"), so a real step completes
      // BEFORE the gated one — which is what makes "did not repeat work"
      // testable at all.
      request: "Recall the suit decisions, then generate a concept image of the suit.",
    });
    expect(result.runId).toBeTruthy();

    const paused = await getRunTrace(gated, { runId: result.runId! });
    expect(paused.status).toBe("WAITING_FOR_PERMISSION");
    // The UI is told exactly what is being asked for, in the plan's own words.
    expect(paused.awaiting?.capability).toBe("media.image.generate");
    expect(paused.awaiting?.requiredLevel).toBe("ACT");
    expect(paused.awaiting?.description).toBeTruthy();
    // Nothing was spent on the step that could not run.
    expect(imageCalls).toBe(0);

    const completedBefore = paused.steps.filter((s) => s.status === "COMPLETED").map((s) => s.order);
    expect(completedBefore.length).toBeGreaterThan(0);

    // Resuming WITHOUT the grant must not slip through.
    await resumeRun(gated, result.runId!);
    expect((await getRunTrace(gated, { runId: result.runId! })).status).toBe("WAITING_FOR_PERMISSION");
    expect(imageCalls).toBe(0);

    // Each capability is gated independently, so the review needs its own
    // grant — the run would otherwise stop again, correctly, one step later.
    await grantPermission(gated, "media.image.generate", "ACT");
    await grantPermission(gated, "qa.visual_review", "ACT");
    await resumeRun(gated, result.runId!);

    const after = await getRunTrace(gated, { runId: result.runId! });
    expect(after.status).toBe("COMPLETED");
    // The previously completed steps were NOT re-run: the memory step's tool
    // would have fired again, and generation ran exactly once in total.
    expect(imageCalls).toBe(1);
    for (const order of completedBefore) {
      expect(after.steps.find((s) => s.order === order)?.status).toBe("COMPLETED");
    }
  });
});

describe("acceptance 3 — resume from persisted state alone", () => {
  it("continues from the next incomplete step with no in-memory state", async () => {
    const restarted = (await createTestUser()).id;
    await grantPermission(restarted, "memory.search", "ACT");
    scoreQueue = [92];

    const result = await driveRequest({
      userId: restarted,
      // Names a subject the router recalls for ("suit"), so a real step completes
      // BEFORE the gated one — which is what makes "did not repeat work"
      // testable at all.
      request: "Recall the suit decisions, then generate a concept image of the suit.",
    });
    const runId = result.runId!;
    expect((await getRunTrace(restarted, { runId })).status).toBe("WAITING_FOR_PERMISSION");

    // Simulate the process dying: nothing from driveRequest survives. The only
    // things that persist are the rows, which is exactly what is read back.
    const persisted = await db.agentRun.findFirst({
      where: { id: runId },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    expect(persisted).toBeTruthy();
    // The trace link survived the "restart" — this is what AgentRun.traceId is
    // for, and without it the run could never be reconnected to its spend.
    expect(persisted!.traceId).toBe(result.traceId);
    expect(persisted!.plan).toBeTruthy();

    const doneOrders = persisted!.steps.filter((s) => s.status === "COMPLETED").map((s) => s.order);
    expect(doneOrders.length).toBeGreaterThan(0);

    await grantPermission(restarted, "media.image.generate", "ACT");
    await grantPermission(restarted, "qa.visual_review", "ACT");
    // Driving the EXISTING executor directly, the way a recovery sweep would.
    await executeRun(restarted, runId);

    const after = await getRunTrace(restarted, { runId });
    expect(after.status).toBe("COMPLETED");
    expect(imageCalls).toBe(1);
    for (const order of doneOrders) {
      expect(after.steps.find((s) => s.order === order)?.status).toBe("COMPLETED");
    }
  });
});

describe("acceptance 4 — a failed review drives another attempt", () => {
  it("iterates, keeps every attempt, and records the lineage", async () => {
    const iterating = (await createTestUser()).id;
    const parent = await createArtifact({ userId: iterating, kind: "IMAGE", label: "Reference", origin: "UPLOADED" });
    const artifact = await createArtifact({ userId: iterating, kind: "IMAGE", label: "Concept", origin: "GENERATED" });

    let generated = 0;
    const scores = [64, 91];
    const outcome = await iterateWithReview({
      userId: iterating,
      artifactId: artifact.id,
      capability: "IMAGE_GENERATION",
      traceId: "trace-iterate",
      maxIterations: 3,
      generate: async (attempt, feedback) => {
        generated += 1;
        // The second attempt genuinely receives the first review's guidance —
        // otherwise "iteration" is just retrying the identical prompt.
        if (attempt === 2) {
          expect(feedback).toBeTruthy();
          expect(feedback!.previousScore).toBe(64);
          expect(feedback!.recommendations.length).toBeGreaterThan(0);
        }
        return {
          data: new Uint8Array(PNG_1X1),
          mimeType: "image/png",
          provider: "test-image",
          model: "test-model-1",
          prompt: `attempt ${attempt}`,
        };
      },
      review: async () => qaResult(scores.shift() ?? 91),
      derivedFrom: [{ versionId: (await db.artifactVersion.findFirst({ where: { artifactId: parent.id } }))?.id ?? "", role: "reference" }].filter((d) => d.versionId),
    });

    expect(generated).toBe(2);
    expect(outcome.stop).toBe("ACCEPTED");
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.best?.attempt).toBe(2);

    // The REJECTED attempt is still on disk. A history showing only the
    // success would show one clean result where there were two.
    const versions = await db.artifactVersion.findMany({ where: { artifactId: artifact.id }, orderBy: { version: "asc" } });
    expect(versions).toHaveLength(2);
    expect(versions[0].prompt).toBe("attempt 1");
  });
});

describe("acceptance 5 — the iteration limit is a real ceiling", () => {
  it("stops at the limit and makes no further provider calls", async () => {
    const capped = (await createTestUser()).id;
    const artifact = await createArtifact({ userId: capped, kind: "IMAGE", label: "Never passes", origin: "GENERATED" });

    let generated = 0;
    let reviewed = 0;
    const outcome = await iterateWithReview({
      userId: capped,
      artifactId: artifact.id,
      capability: "IMAGE_GENERATION",
      traceId: "trace-capped",
      maxIterations: 3,
      generate: async (attempt) => {
        generated += 1;
        return {
          data: new Uint8Array(PNG_1X1),
          mimeType: "image/png",
          provider: "test-image",
          model: "test-model-1",
          prompt: `attempt ${attempt}`,
        };
      },
      review: async () => {
        reviewed += 1;
        // GENERATION_ARTIFACT keeps the loop going (REGENERATE) so the ceiling
        // itself is what stops it, rather than an early strategy exit.
        return {
          status: "FAIL",
          score: 40,
          issues: [{ kind: "GENERATION_ARTIFACT", severity: "MAJOR", description: "Smeared texture." }],
          recommendations: ["Resample."],
          model: "test-vision-1",
        } as QaResult;
      },
    });

    expect(outcome.stop).toBe("ITERATION_LIMIT");
    // Exactly the ceiling — not one more.
    expect(generated).toBe(3);
    expect(reviewed).toBe(3);
    expect(outcome.attempts).toHaveLength(3);
    // The failed state is preserved rather than discarded.
    expect(outcome.best).toBeTruthy();
    expect(outcome.best!.accepted).toBe(false);
    expect(await db.artifactVersion.count({ where: { artifactId: artifact.id } })).toBe(3);
  });
});

describe("cancellation preserves what already happened", () => {
  it("stops the run without deleting completed work or artifacts", async () => {
    const stopping = (await createTestUser()).id;
    await grantPermission(stopping, "memory.search", "ACT");

    const result = await driveRequest({
      userId: stopping,
      // Names a subject the router recalls for ("suit"), so a real step completes
      // BEFORE the gated one — which is what makes "did not repeat work"
      // testable at all.
      request: "Recall the suit decisions, then generate a concept image of the suit.",
    });
    const runId = result.runId!;
    const before = await getRunTrace(stopping, { runId });
    const completed = before.steps.filter((s) => s.status === "COMPLETED").map((s) => s.order);
    expect(completed.length).toBeGreaterThan(0);

    await cancelRun(stopping, runId);

    const after = await getRunTrace(stopping, { runId });
    expect(after.status).toBe("CANCELLED");
    // Completed steps keep their state; only unreached ones are skipped.
    for (const order of completed) {
      expect(after.steps.find((s) => s.order === order)?.status).toBe("COMPLETED");
    }
    expect(after.steps.some((s) => s.status === "SKIPPED")).toBe(true);
  });
});
