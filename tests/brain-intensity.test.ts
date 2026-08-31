import { describe, it, expect } from "vitest";
import { activityIntensity, stateForActivity, EMPTY_ACTIVITY, type ActivitySnapshot } from "@/lib/brain/intensity";

/**
 * The Brain's intensity scalar.
 *
 * These tests exist because the number drives how alive the Brain looks, and a
 * visualization that looks busy while nothing is happening is the exact failure
 * the whole event pipeline was built to prevent. The first and last cases below
 * are the load-bearing ones: no work must render as no activity, and the scalar
 * must never leave 0..1 no matter what it is handed.
 */

function activity(partial: Partial<ActivitySnapshot>): ActivitySnapshot {
  return { ...EMPTY_ACTIVITY, ...partial };
}

describe("activityIntensity", () => {
  it("is exactly zero when nothing is happening", () => {
    // Not "close to zero" — a Brain that shimmers at idle is a decorative
    // loading animation pretending to be cognition.
    expect(activityIntensity(EMPTY_ACTIVITY)).toBe(0);
  });

  it("gives one active run a moderate reading, not a maximal one", () => {
    const value = activityIntensity(activity({ runningRuns: 1 }));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(0.5);
  });

  it("rises with concurrency but with diminishing returns", () => {
    const one = activityIntensity(activity({ runningRuns: 1 }));
    const two = activityIntensity(activity({ runningRuns: 2 }));
    const four = activityIntensity(activity({ runningRuns: 4 }));

    expect(two).toBeGreaterThan(one);
    expect(four).toBeGreaterThan(two);
    // Four runs must not read as four times one, or a burst of cheap steps
    // pins the Brain at maximum and "busy" stops meaning anything.
    expect(four).toBeLessThan(one * 4);
  });

  it("treats an in-flight provider call as the most expensive single source", () => {
    const capability = activityIntensity(activity({ activeCapabilityRuns: 1 }));
    const planning = activityIntensity(activity({ planningRuns: 1 }));
    expect(capability).toBeGreaterThan(planning);
  });

  it("reads a refinement loop as more intense on later attempts", () => {
    const first = activityIntensity(activity({ runningRuns: 1, iteration: { attempt: 1, limit: 3 } }));
    const third = activityIntensity(activity({ runningRuns: 1, iteration: { attempt: 3, limit: 3 } }));
    expect(third).toBeGreaterThan(first);
  });

  it("counts generation and review running together as busier than either alone", () => {
    const generating = activityIntensity(activity({ runningRuns: 1, activeCapabilityRuns: 1 }));
    const both = activityIntensity(activity({ runningRuns: 1, activeCapabilityRuns: 2 }));
    expect(both).toBeGreaterThan(generating);
  });

  it("keeps a permission pause quiet — waiting is not working", () => {
    const waiting = activityIntensity(activity({ awaitingPermission: true }));
    const working = activityIntensity(activity({ runningRuns: 1 }));
    expect(waiting).toBeGreaterThan(0); // not dark; something IS pending
    expect(waiting).toBeLessThan(working);
  });

  it("does not let a permission pause stack on top of real execution", () => {
    const working = activityIntensity(activity({ runningRuns: 2 }));
    const workingAndWaiting = activityIntensity(activity({ runningRuns: 2, awaitingPermission: true }));
    expect(workingAndWaiting).toBe(working);
  });

  it("clamps to 1 under extreme load", () => {
    const value = activityIntensity(
      activity({ runningRuns: 50, planningRuns: 50, activeCapabilityRuns: 50, iteration: { attempt: 9, limit: 3 } }),
    );
    expect(value).toBe(1);
  });

  it("is deterministic — identical input, identical output", () => {
    const input = activity({ runningRuns: 3, activeCapabilityRuns: 2, iteration: { attempt: 2, limit: 4 } });
    const runs = Array.from({ length: 5 }, () => activityIntensity({ ...input }));
    expect(new Set(runs).size).toBe(1);
  });

  it("survives malformed counts instead of blanking the Brain with NaN", () => {
    // This feeds a render loop, so a NaN here would silently blank the surface
    // rather than fail somewhere a developer would notice.
    const value = activityIntensity(activity({ runningRuns: -5, activeCapabilityRuns: Number.NaN }));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("never leaves 0..1 across a sweep of plausible inputs", () => {
    for (let runs = 0; runs <= 6; runs++) {
      for (let caps = 0; caps <= 6; caps++) {
        for (const attempt of [null, 1, 2, 3]) {
          const value = activityIntensity(
            activity({
              runningRuns: runs,
              activeCapabilityRuns: caps,
              iteration: attempt === null ? null : { attempt, limit: 3 },
            }),
          );
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("stateForActivity", () => {
  it("agrees with the scalar: idle state means zero intensity", () => {
    // The two signals must never contradict each other on screen.
    expect(stateForActivity(EMPTY_ACTIVITY)).toBe("idle");
    expect(activityIntensity(EMPTY_ACTIVITY)).toBe(0);
  });

  it("reports failure ahead of everything else", () => {
    expect(stateForActivity(activity({ failed: true, runningRuns: 2 }))).toBe("error");
  });

  it("reports a permission pause as waiting, not as executing", () => {
    expect(stateForActivity(activity({ awaitingPermission: true }))).toBe("waiting");
  });

  it("separates planning from executing", () => {
    expect(stateForActivity(activity({ planningRuns: 1 }))).toBe("thinking");
    expect(stateForActivity(activity({ runningRuns: 1 }))).toBe("executing");
  });

  it("treats a running refinement loop as executing even with no run row counted", () => {
    expect(stateForActivity(activity({ iteration: { attempt: 2, limit: 3 } }))).toBe("executing");
  });
});
