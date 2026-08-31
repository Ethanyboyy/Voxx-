import type { BrainState } from "@/lib/brain/graph";

/**
 * How hard VOX is working right now, as a bounded scalar the Brain can render.
 *
 * WHY THIS EXISTS. `BrainState` is categorical — `executing` means the same
 * thing whether one memory lookup is running or three image attempts are being
 * reviewed in parallel. The information needed to tell those apart is already
 * in the database (AgentRun rows, CapabilityRun rows, the iteration loop's own
 * attempt counter); it was simply being discarded before it reached the
 * visualization. This module is the smallest thing that keeps it.
 *
 * WHAT IT IS NOT. This is a VISUALIZATION SIGNAL and nothing else. It never
 * starts a run, never calls a provider, never writes an Event, and is never
 * read back by the executor. It is a pure function of counts that already
 * exist, so the same input always produces the same output and it can be
 * tested without a database, a browser or a GPU.
 *
 * The one rule that matters: **no activity must produce exactly 0.** A Brain
 * that shimmers when nothing has happened is a decorative loading animation,
 * which is the specific dishonesty the whole event pipeline exists to avoid.
 */

/** Real, in-flight work. Every field is a count of rows or a value read off one. */
export interface ActivitySnapshot {
  /** AgentRun rows in RUNNING. */
  runningRuns: number;
  /** AgentRun rows in PLANNING — real work, but cheaper than execution. */
  planningRuns: number;
  /** CapabilityRun rows in RUNNING (one per in-flight provider call). */
  activeCapabilityRuns: number;
  /** The improvement loop's position, when one is running. */
  iteration: { attempt: number; limit: number } | null;
  /** A run parked on a permission gate. Deliberately LOW — waiting is not work. */
  awaitingPermission: boolean;
  /** A run in a terminal failed state. */
  failed: boolean;
}

export const EMPTY_ACTIVITY: ActivitySnapshot = {
  runningRuns: 0,
  planningRuns: 0,
  activeCapabilityRuns: 0,
  iteration: null,
  awaitingPermission: false,
  failed: false,
};

/**
 * Per-source contributions, summed then clamped.
 *
 * The weights are ordered by how much work the thing actually represents, not
 * by how interesting it looks: a provider call in flight is the most expensive
 * thing VOX does, so it dominates; planning is real but cheap; a permission
 * pause contributes almost nothing because the system is, precisely, not
 * working.
 *
 * Diminishing returns on the two countable sources (sqrt rather than linear)
 * keep a burst of ten cheap steps from pinning the Brain at maximum and
 * flattening the difference between "busy" and "very busy".
 */
const WEIGHT = {
  /** First running run; further ones add sqrt-scaled. */
  run: 0.34,
  planning: 0.16,
  /** A provider call in flight — the most expensive real work. */
  capabilityRun: 0.30,
  /** Added once when a refinement loop is running, plus progress through it. */
  iterationBase: 0.12,
  iterationPerAttempt: 0.10,
  /** Parked, not working. Non-zero only so the Brain is not fully dark. */
  awaiting: 0.08,
  /** A failure is a state, not an intensity — error reads through colour. */
  failed: 0.05,
} as const;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Diminishing returns: 1 → 1, 2 → 1.41, 4 → 2, 9 → 3. */
function diminished(count: number): number {
  return count <= 0 ? 0 : Math.sqrt(count);
}

/**
 * Maps real in-flight work to 0..1.
 *
 * Deterministic and total: no clock, no randomness, no I/O. Negative or
 * non-finite counts are treated as absent rather than throwing, because this
 * feeds a render loop and a NaN here would blank the Brain rather than fail
 * loudly somewhere useful.
 */
export function activityIntensity(activity: ActivitySnapshot): number {
  const runs = Math.max(0, activity.runningRuns || 0);
  const planning = Math.max(0, activity.planningRuns || 0);
  const capabilityRuns = Math.max(0, activity.activeCapabilityRuns || 0);

  let total = 0;
  total += diminished(runs) * WEIGHT.run;
  total += diminished(planning) * WEIGHT.planning;
  total += diminished(capabilityRuns) * WEIGHT.capabilityRun;

  if (activity.iteration) {
    const { attempt, limit } = activity.iteration;
    total += WEIGHT.iterationBase;
    // Later attempts are more intense: the system is working harder at
    // something it has already failed at once.
    const safeLimit = limit > 0 ? limit : 1;
    const progress = clamp01((Math.max(1, attempt) - 1) / safeLimit);
    total += progress * WEIGHT.iterationPerAttempt;
  }

  // A permission pause and a failure are floors, not additions — they must not
  // stack on top of execution weight and read as "busier than working".
  if (total === 0 && activity.awaitingPermission) total = WEIGHT.awaiting;
  if (total === 0 && activity.failed) total = WEIGHT.failed;

  return clamp01(total);
}

/**
 * The categorical state that goes with a snapshot.
 *
 * Kept beside the scalar so the two can never disagree — a Brain rendering
 * `idle` at intensity 0.8 would be worse than either signal alone. Mirrors the
 * precedence getBrainState() already uses: failure, then waiting, then work.
 */
export function stateForActivity(activity: ActivitySnapshot): BrainState {
  if (activity.failed) return "error";
  if (activity.awaitingPermission) return "waiting";
  if (activity.runningRuns > 0 || activity.activeCapabilityRuns > 0 || activity.iteration) return "executing";
  if (activity.planningRuns > 0) return "thinking";
  return "idle";
}
