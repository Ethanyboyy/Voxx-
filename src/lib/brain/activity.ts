import { db } from "@/lib/db";
import { activityIntensity, stateForActivity, EMPTY_ACTIVITY, type ActivitySnapshot } from "@/lib/brain/intensity";
import type { BrainState } from "@/lib/brain/graph";

/**
 * What VOX is doing right now, counted from live rows.
 *
 * WHY THIS EXISTS. `getBrainState()` reads AgentRun, SupervisorRun and Proposal
 * — but not CapabilityRun, and not the improvement loop. Since BRAIN-021 made
 * chat the primary way work starts, that gap means the product's main entry
 * point reaches its own visualization as an undifferentiated "executing": one
 * memory lookup and three image attempts under review look identical. The
 * counts to tell them apart were already in the database; nothing was reading
 * them.
 *
 * This reads them, and hands them to the pure scoring function in
 * `intensity.ts` (which had tests but no callers). Splitting it this way keeps
 * the I/O here and the judgement there, so the weighting stays unit-testable
 * without a database.
 *
 * IT IS A VISUALIZATION SIGNAL. It never starts a run, never calls a provider,
 * never writes an Event. A read-only count that drives how alive the Brain
 * looks, and nothing else.
 */

export interface BrainActivity {
  snapshot: ActivitySnapshot;
  /** 0..1. Exactly 0 when nothing is happening — an idle Brain looks idle. */
  intensity: number;
  /** The categorical state implied by the same counts, so the two agree. */
  state: BrainState;
}

/** The attempt ceiling the improvement loop enforces. Mirrors capabilities/refine.ts. */
const ITERATION_LIMIT = 3;

/** A failure older than this is history, not the current state of the system. */
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

export async function getBrainActivity(userId: string): Promise<BrainActivity> {
  const [runningRuns, planningRuns, awaitingRuns, failedRuns, activeCapabilityRuns, liveRunIds] = await Promise.all([
    db.agentRun.count({ where: { userId, status: "RUNNING" } }),
    db.agentRun.count({ where: { userId, status: "PLANNING" } }),
    db.agentRun.count({ where: { userId, status: { in: ["WAITING_FOR_PERMISSION", "WAITING"] } } }),
    // Only a RECENT failure should colour the Brain red. A run that failed last
    // week is history, not the current state of the system.
    db.agentRun.count({
      where: { userId, status: "FAILED", updatedAt: { gte: new Date(Date.now() - FAILURE_WINDOW_MS) } },
    }),
    db.capabilityRun.count({ where: { userId, status: "RUNNING" } }),
    db.agentRun.findMany({
      where: { userId, status: { in: ["RUNNING", "PLANNING"] } },
      select: { traceId: true },
    }),
  ]);

  // Attempt number comes from the append-only artifact versions the loop writes,
  // which is the same place resume recovers its position from — so the Brain and
  // the loop can never disagree about which attempt is in flight. A version has
  // no traceId of its own; it reaches one through the CapabilityRun that made it.
  const traceIds = liveRunIds.map((r) => r.traceId).filter((t): t is string => Boolean(t));
  const attempt = traceIds.length > 0 ? await currentAttempt(traceIds) : 0;

  const snapshot: ActivitySnapshot = {
    ...EMPTY_ACTIVITY,
    runningRuns,
    planningRuns,
    activeCapabilityRuns,
    iteration: attempt > 0 ? { attempt, limit: ITERATION_LIMIT } : null,
    awaitingPermission: awaitingRuns > 0,
    failed: failedRuns > 0,
  };

  return { snapshot, intensity: activityIntensity(snapshot), state: stateForActivity(snapshot) };
}


async function currentAttempt(traceIds: string[]): Promise<number> {
  const versions = await db.artifactVersion.findMany({
    where: { capabilityRun: { traceId: { in: traceIds } } },
    select: { parameters: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  let highest = 0;
  for (const version of versions) {
    if (!version.parameters) continue;
    try {
      const parsed = JSON.parse(version.parameters) as { attempt?: unknown };
      if (typeof parsed.attempt === "number" && parsed.attempt > highest) highest = parsed.attempt;
    } catch {
      // A malformed parameters blob is not worth failing a visualization over.
    }
  }
  return highest;
}
