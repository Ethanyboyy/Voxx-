import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "./helpers";
import { getRequestProgress } from "@/lib/capabilities/trace";

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  userId = (await createTestUser()).id;
  otherUserId = (await createTestUser()).id;
});

async function seedTrace(ownerId: string, traceId: string) {
  const run = await db.agentRun.create({
    data: {
      userId: ownerId,
      objective: "Make the mask read as equipment",
      status: "WAITING_FOR_PERMISSION",
      currentStep: 1,
    },
  });

  await db.agentStep.createMany({
    data: [
      {
        runId: run.id,
        order: 0,
        description: "Recall the mask decisions",
        toolName: "memory.search",
        status: "COMPLETED",
        capability: "memory.search",
        requiredLevel: "OBSERVE",
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(Date.now() - 4200),
      },
      {
        runId: run.id,
        order: 1,
        description: "Generate the concept",
        toolName: "media.image.generate",
        status: "WAITING_FOR_PERMISSION",
        capability: "media.image.generate",
        requiredLevel: "ACT",
      },
    ],
  });

  const priced = await db.capabilityRun.create({
    data: {
      userId: ownerId,
      capability: "IMAGE_GENERATION",
      provider: "gemini",
      model: "nano-banana-2",
      status: "SUCCEEDED",
      traceId,
      durationMs: 3200,
      costUsd: 0.0042,
      completedAt: new Date(),
    },
  });

  // A call the provider never priced — the case that must not be summed as 0.
  await db.capabilityRun.create({
    data: {
      userId: ownerId,
      capability: "VISUAL_QA",
      provider: "anthropic",
      status: "SUCCEEDED",
      traceId,
      durationMs: 900,
      completedAt: new Date(),
    },
  });

  const artifact = await db.artifact.create({
    data: { userId: ownerId, kind: "IMAGE", label: "Mask concept", origin: "GENERATED" },
  });
  await db.artifactVersion.create({
    data: {
      artifactId: artifact.id,
      version: 1,
      url: "/artifacts/ab/11111111-1111-4111-8111-111111111111.png",
      mimeType: "image/png",
      bytes: 1024,
      provider: "gemini",
      capabilityRunId: priced.id,
      // Content that must never reach the progress payload.
      prompt: "SECRET internal prompt text",
    },
  });

  return { runId: run.id, artifactId: artifact.id };
}

describe("request progress", () => {
  it("joins the run, its provider calls and what they produced", async () => {
    const traceId = "trace-progress-1";
    const { runId } = await seedTrace(userId, traceId);

    const progress = await getRequestProgress(userId, traceId, runId);

    expect(progress.objective).toContain("mask");
    expect(progress.status).toBe("WAITING_FOR_PERMISSION");
    expect(progress.steps.map((s) => s.status)).toEqual(["COMPLETED", "WAITING_FOR_PERMISSION"]);
    expect(progress.providerCalls).toHaveLength(2);
    expect(progress.artifacts).toHaveLength(1);
    expect(progress.artifacts[0].url).toBe("/artifacts/ab/11111111-1111-4111-8111-111111111111.png");
  });

  it("reports the permission the executor actually stopped on", async () => {
    const traceId = "trace-progress-2";
    const { runId } = await seedTrace(userId, traceId);

    const progress = await getRequestProgress(userId, traceId, runId);
    expect(progress.awaiting).toEqual({
      capability: "media.image.generate",
      requiredLevel: "ACT",
      toolName: "media.image.generate",
      // The user is approving an ACTION, not a capability string, so the
      // step's own description travels with the request.
      description: "Generate the concept",
    });
  });

  it("measures a completed step's real duration and reports none for an unfinished one", async () => {
    const traceId = "trace-progress-3";
    const { runId } = await seedTrace(userId, traceId);

    const progress = await getRequestProgress(userId, traceId, runId);
    expect(progress.steps[0].durationMs).toBeGreaterThan(0);
    // Never a fabricated elapsed time for a step that has not started.
    expect(progress.steps[1].durationMs).toBeNull();
  });

  it("sums only reported costs and counts the rest, so the total reads as a floor", async () => {
    const traceId = "trace-progress-4";
    const { runId } = await seedTrace(userId, traceId);

    const progress = await getRequestProgress(userId, traceId, runId);
    expect(progress.costUsd).toBeCloseTo(0.0042, 6);
    expect(progress.unpricedCalls).toBe(1);
  });

  it("reports no cost at all — not zero — when nothing priced anything", async () => {
    const traceId = "trace-progress-unpriced";
    await db.capabilityRun.create({
      data: { userId, capability: "VISUAL_QA", provider: "anthropic", status: "SUCCEEDED", traceId },
    });

    const progress = await getRequestProgress(userId, traceId);
    // Zero would read as "this was free". Null is the honest answer.
    expect(progress.costUsd).toBeNull();
  });

  it("never returns step inputs, outputs, or generation prompts", async () => {
    const traceId = "trace-progress-5";
    const { runId } = await seedTrace(userId, traceId);

    const progress = await getRequestProgress(userId, traceId, runId);
    const serialized = JSON.stringify(progress);
    expect(serialized).not.toContain("SECRET internal prompt text");
    for (const step of progress.steps) {
      expect(step).not.toHaveProperty("input");
      expect(step).not.toHaveProperty("output");
    }
  });

  it("stays live while a submitted job is still running, even once the run has finished", async () => {
    const traceId = "trace-progress-live";
    const run = await db.agentRun.create({
      data: { userId, objective: "Film it", status: "COMPLETED", completedAt: new Date() },
    });
    await db.capabilityRun.create({
      data: { userId, capability: "VIDEO_GENERATION", provider: "higgsfield", status: "RUNNING", traceId },
    });

    const progress = await getRequestProgress(userId, traceId, run.id);
    expect(progress.status).toBe("COMPLETED");
    // The video job has not landed yet, so there is still something to wait for.
    expect(progress.live).toBe(true);
  });

  it("settles once the run finished and every call closed", async () => {
    const traceId = "trace-progress-settled";
    const run = await db.agentRun.create({
      data: { userId, objective: "Done", status: "COMPLETED", completedAt: new Date() },
    });
    await db.capabilityRun.create({
      data: { userId, capability: "IMAGE_GENERATION", provider: "gemini", status: "SUCCEEDED", traceId },
    });

    const progress = await getRequestProgress(userId, traceId, run.id);
    expect(progress.live).toBe(false);
  });

  it("shows another user's trace as empty rather than as their work", async () => {
    const traceId = "trace-progress-theirs";
    const { runId } = await seedTrace(otherUserId, traceId);

    // Guessing a traceId — and even a runId — must reveal nothing.
    const progress = await getRequestProgress(userId, traceId, runId);
    expect(progress.runId).toBeNull();
    expect(progress.objective).toBeNull();
    expect(progress.steps).toEqual([]);
    expect(progress.providerCalls).toEqual([]);
    expect(progress.artifacts).toEqual([]);
  });
});
