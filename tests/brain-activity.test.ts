import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getBrainActivity } from "@/lib/brain/activity";
import { createTestUser } from "./helpers";

/**
 * The Brain's activity signal, read from real rows.
 *
 * The claim these tests defend is narrow and load-bearing: the Brain reflects
 * what VOX is ACTUALLY doing. Before this module the visualization could not
 * see CapabilityRun at all, so a chat-started run — the product's main entry
 * point — arrived as an undifferentiated "executing". A visualization that
 * cannot tell one memory lookup from three concurrent provider calls is
 * decoration, and the first test below is the one that keeps it honest: no
 * work must read as exactly zero, never a resting shimmer.
 */

let userId: string;

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
});

describe("getBrainActivity", () => {
  it("reports exactly zero when nothing is happening", async () => {
    const activity = await getBrainActivity(userId);
    expect(activity.intensity).toBe(0);
    expect(activity.state).toBe("idle");
    expect(activity.snapshot.runningRuns).toBe(0);
    expect(activity.snapshot.activeCapabilityRuns).toBe(0);
  });

  it("counts a running agent run", async () => {
    await db.agentRun.create({ data: { userId, objective: "do a thing", status: "RUNNING" } });
    const activity = await getBrainActivity(userId);
    expect(activity.snapshot.runningRuns).toBe(1);
    expect(activity.intensity).toBeGreaterThan(0);
    expect(activity.state).toBe("executing");
  });

  it("sees CapabilityRun, which getBrainState cannot", async () => {
    // The specific gap this module exists to close.
    await db.capabilityRun.create({
      data: { userId, capability: "media.image.generate", provider: "test", status: "RUNNING", traceId: "t-cap" },
    });
    const activity = await getBrainActivity(userId);
    expect(activity.snapshot.activeCapabilityRuns).toBe(1);
    expect(activity.intensity).toBeGreaterThan(0);
  });

  it("reads busier when more is genuinely in flight", async () => {
    await db.agentRun.create({ data: { userId, objective: "one", status: "RUNNING" } });
    const quiet = await getBrainActivity(userId);

    await db.agentRun.create({ data: { userId, objective: "two", status: "RUNNING" } });
    await db.capabilityRun.create({
      data: { userId, capability: "media.image.generate", provider: "test", status: "RUNNING", traceId: "t-1" },
    });
    const busy = await getBrainActivity(userId);

    expect(busy.intensity).toBeGreaterThan(quiet.intensity);
  });

  it("treats a permission pause as waiting, not as work", async () => {
    await db.agentRun.create({ data: { userId, objective: "gated", status: "WAITING_FOR_PERMISSION" } });
    const activity = await getBrainActivity(userId);
    expect(activity.state).toBe("waiting");
    expect(activity.snapshot.awaitingPermission).toBe(true);
    // Present, but quieter than actual execution.
    await db.agentRun.create({ data: { userId, objective: "working", status: "RUNNING" } });
    const working = await getBrainActivity(userId);
    expect(working.intensity).toBeGreaterThan(activity.intensity);
  });

  it("ignores a failure that is no longer current", async () => {
    // A run that failed last week is history. Colouring the Brain red forever
    // would make the error state meaningless.
    const old = await db.agentRun.create({ data: { userId, objective: "ancient", status: "FAILED" } });
    await db.agentRun.update({
      where: { id: old.id },
      data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const activity = await getBrainActivity(userId);
    expect(activity.snapshot.failed).toBe(false);
    expect(activity.state).toBe("idle");
  });

  it("scopes to the user — one account's work never lights another's Brain", async () => {
    const other = await createTestUser();
    await db.agentRun.create({ data: { userId: other.id, objective: "theirs", status: "RUNNING" } });
    const mine = await getBrainActivity(userId);
    expect(mine.snapshot.runningRuns).toBe(0);
    expect(mine.intensity).toBe(0);
  });

  it("never leaves 0..1", async () => {
    for (let i = 0; i < 12; i++) {
      await db.agentRun.create({ data: { userId, objective: `run ${i}`, status: "RUNNING" } });
      await db.capabilityRun.create({
        data: { userId, capability: "media.image.generate", provider: "test", status: "RUNNING", traceId: `t-${i}` },
      });
    }
    const activity = await getBrainActivity(userId);
    expect(activity.intensity).toBeGreaterThanOrEqual(0);
    expect(activity.intensity).toBeLessThanOrEqual(1);
  });
});
