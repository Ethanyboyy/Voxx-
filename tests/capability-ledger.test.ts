import { describe, it, expect, beforeAll } from "vitest";
import {
  checkBudget,
  completeRun,
  failRun,
  getTrace,
  getUsageSummary,
  newTraceId,
  openRun,
  refuseRun,
  DEFAULT_BUDGET,
} from "@/lib/capabilities/ledger";
import { getProviderStatuses, getCapabilityAvailability } from "@/lib/capabilities/availability";
import { GeminiImageProvider } from "@/lib/image/gemini";
import { UnavailableImageProvider } from "@/lib/image/unavailable";
import { HiggsfieldVideoProvider } from "@/lib/video/higgsfield";
import { UnavailableVideoProvider } from "@/lib/video/unavailable";
import { signalKindForEvent } from "@/lib/3d/signals";
import { createTestUser } from "./helpers";

describe("capability ledger", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await createTestUser()).id;
  });

  it("opens a run before the call and closes it with measured duration", async () => {
    const traceId = newTraceId();
    const run = await openRun({ userId, capability: "IMAGE_GENERATION", provider: "gemini", traceId });
    expect(run.status).toBe("RUNNING");
    // A crash between these two points leaves a RUNNING row — evidence that
    // money may have been spent — rather than no record at all.
    const done = await completeRun(userId, run.id, { costUsd: 0.02, providerRunId: "abc" });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
    expect(done.costUsd).toBe(0.02);
    expect(done.providerRunId).toBe("abc");
  });

  it("records a failure with a message, not a stack trace", async () => {
    const run = await openRun({ userId, capability: "IMAGE_GENERATION", provider: "gemini", traceId: newTraceId() });
    const failed = await failRun(userId, run.id, "provider returned no image data");
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toBe("provider returned no image data");
  });

  it("distinguishes REFUSED from FAILED", async () => {
    // A call the budget declined is the system working. Conflating it with a
    // call that was attempted and broke makes the failure rate meaningless.
    const run = await refuseRun({
      userId,
      capability: "VIDEO_GENERATION",
      provider: "higgsfield",
      traceId: newTraceId(),
      reason: "daily limit reached",
    });
    expect(run.status).toBe("REFUSED");
    expect(run.durationMs).toBe(0);
  });

  it("reconstructs a whole task from its trace id", async () => {
    const traceId = newTraceId();
    const a = await openRun({ userId, capability: "IMAGE_GENERATION", provider: "gemini", traceId });
    await completeRun(userId, a.id, {});
    const b = await openRun({ userId, capability: "VIDEO_GENERATION", provider: "higgsfield", traceId });
    await failRun(userId, b.id, "unreachable");

    const trace = await getTrace(userId, traceId);
    expect(trace).toHaveLength(2);
    expect(trace[0].capability).toBe("IMAGE_GENERATION");
    expect(trace[1].status).toBe("FAILED");
  });

  it("does not meter capabilities that spend nothing externally", async () => {
    const decision = await checkBudget(userId, "MEMORY");
    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBeNull();
  });

  it("refuses once the daily call limit is reached", async () => {
    const fresh = (await createTestUser()).id;
    const policy = { dailyCalls: { VIDEO_GENERATION: 2 } };

    for (let i = 0; i < 2; i++) {
      const decision = await checkBudget(fresh, "VIDEO_GENERATION", policy);
      expect(decision.allowed).toBe(true);
      const run = await openRun({ userId: fresh, capability: "VIDEO_GENERATION", provider: "higgsfield", traceId: newTraceId() });
      await completeRun(fresh, run.id, {});
    }

    const blocked = await checkBudget(fresh, "VIDEO_GENERATION", policy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.used).toBe(2);
    expect(blocked.reason).toMatch(/limit/i);
  });

  it("does not let refusals count toward the limit", async () => {
    // Otherwise a burst of refusals locks the user out for the rest of the
    // window on the strength of calls that never reached a provider.
    const fresh = (await createTestUser()).id;
    const policy = { dailyCalls: { IMAGE_GENERATION: 2 } };

    for (let i = 0; i < 5; i++) {
      await refuseRun({
        userId: fresh,
        capability: "IMAGE_GENERATION",
        provider: "gemini",
        traceId: newTraceId(),
        reason: "test",
      });
    }

    const decision = await checkBudget(fresh, "IMAGE_GENERATION", policy);
    expect(decision.allowed).toBe(true);
    expect(decision.used).toBe(0);
  });

  it("enforces a daily spend ceiling", async () => {
    const fresh = (await createTestUser()).id;
    const run = await openRun({ userId: fresh, capability: "VIDEO_GENERATION", provider: "higgsfield", traceId: newTraceId() });
    await completeRun(fresh, run.id, { costUsd: 5 });

    const decision = await checkBudget(fresh, "VIDEO_GENERATION", { dailyUsd: 4 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/spend/i);
  });

  it("ships a default budget so an unconfigured system cannot run unbounded", async () => {
    expect(DEFAULT_BUDGET.dailyCalls.VIDEO_GENERATION).toBeGreaterThan(0);
    // Video costs roughly an order of magnitude more than images everywhere,
    // so its allowance is correspondingly smaller.
    expect(DEFAULT_BUDGET.dailyCalls.VIDEO_GENERATION!).toBeLessThan(
      DEFAULT_BUDGET.dailyCalls.IMAGE_GENERATION!,
    );
    expect(DEFAULT_BUDGET.maxIterations).toBe(3);
  });

  it("summarises usage separating refusals from real calls", async () => {
    const fresh = (await createTestUser()).id;
    const run = await openRun({ userId: fresh, capability: "IMAGE_GENERATION", provider: "gemini", traceId: newTraceId() });
    await completeRun(fresh, run.id, { costUsd: 0.03 });
    await refuseRun({ userId: fresh, capability: "IMAGE_GENERATION", provider: "gemini", traceId: newTraceId(), reason: "x" });

    const summary = await getUsageSummary(fresh);
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.03, 5);
    expect(summary.byCapability.IMAGE_GENERATION.refused).toBe(1);
  });
});

describe("provider honesty", () => {
  it("reports Gemini unconfigured without a key, and says which one", () => {
    const provider = new GeminiImageProvider(null);
    expect(provider.isConfigured).toBe(false);
    expect(provider.unavailableReason).toContain("GOOGLE_API_KEY");
  });

  it("reports Gemini configured with a key", () => {
    const provider = new GeminiImageProvider("test-key");
    expect(provider.isConfigured).toBe(true);
    expect(provider.unavailableReason).toBeNull();
    expect(provider.capabilities).toContain("IMAGE_EDIT");
  });

  it("throws rather than returning an empty result when unconfigured", async () => {
    // A caller that got back zero images with no error would reasonably
    // record an artifact with nothing in it.
    await expect(new GeminiImageProvider(null).generate({ prompt: "x" })).rejects.toThrow(/not configured/);
  });

  it("never returns a placeholder image", async () => {
    const provider = new UnavailableImageProvider("no key");
    await expect(provider.generate({ prompt: "a suit" })).rejects.toThrow(/will not return a placeholder/);
    expect(provider.capabilities).toHaveLength(0);
  });

  it("requires Higgsfield to have BOTH a key and an explicit endpoint", () => {
    // The API shape could not be verified against the live service from this
    // environment, so requiring the operator to name the endpoint is what
    // stops the adapter reporting itself ready where nobody has checked it.
    expect(new HiggsfieldVideoProvider("key", null).isConfigured).toBe(false);
    expect(new HiggsfieldVideoProvider(null, "https://example.test").isConfigured).toBe(false);
    expect(new HiggsfieldVideoProvider("key", "https://example.test").isConfigured).toBe(true);
  });

  it("explains the unreachability rather than just saying 'not set'", () => {
    const reason = new HiggsfieldVideoProvider(null, null).unavailableReason ?? "";
    expect(reason).toContain("HIGGSFIELD_API_KEY");
    expect(reason).toMatch(/unreachable/i);
  });

  it("offers the still-image fallback when video is unavailable", async () => {
    const provider = new UnavailableVideoProvider("not configured");
    await expect(provider.submit({ prompt: "reveal" })).rejects.toThrow(/still concept can still be generated/);
    await expect(provider.poll("job-1")).rejects.toThrow(/unavailable/);
  });
});

describe("capability availability", () => {
  it("reports a status for every externally-provided capability", () => {
    const statuses = getProviderStatuses();
    const capabilities = statuses.map((s) => s.capability);
    expect(capabilities).toContain("IMAGE_GENERATION");
    expect(capabilities).toContain("VIDEO_GENERATION");
    expect(capabilities).toContain("MODEL_3D");
  });

  it("gives an actionable reason for anything unconfigured", () => {
    for (const status of getProviderStatuses()) {
      if (!status.configured) expect(status.reason).toBeTruthy();
      else expect(status.reason).toBeNull();
    }
  });

  it("produces the map the router consumes", () => {
    const map = getCapabilityAvailability();
    expect(typeof map.IMAGE_GENERATION).toBe("boolean");
    expect(typeof map.VIDEO_GENERATION).toBe("boolean");
  });
});

describe("fabric event classification", () => {
  it("treats routing as reasoning and a provider call as execution", () => {
    expect(signalKindForEvent("capability.routed")).toBe("reasoning");
    expect(signalKindForEvent("provider.started")).toBe("execution");
    expect(signalKindForEvent("provider.completed")).toBe("execution");
  });

  it("treats a new artifact as something learned", () => {
    expect(signalKindForEvent("artifact.created")).toBe("memory");
    expect(signalKindForEvent("artifact.version_created")).toBe("memory");
  });

  it("keeps non-work events out of the Brain's signal", () => {
    // A refused call never left the building; reporting activity for it would
    // show work that did not happen.
    expect(signalKindForEvent("provider.refused")).toBeNull();
    expect(signalKindForEvent("capability.requested")).toBeNull();
    expect(signalKindForEvent("artifact.version_selected")).toBeNull();
  });
});
