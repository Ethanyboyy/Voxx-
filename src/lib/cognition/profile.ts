import { db } from "@/lib/db";
import { CognitiveDimension, type Confidence } from "@/generated/prisma/enums";
import type { Observation } from "@/generated/prisma/client";

const DIMENSIONS = Object.values(CognitiveDimension) as CognitiveDimension[];
const RECENT_WINDOW_DAYS = 14;

export type Trend = "improving" | "declining" | "stable" | "unknown";

export interface DimensionProfile {
  dimension: CognitiveDimension;
  /** How many raw Observation rows exist for this dimension — real, not inferred. */
  observationCount: number;
  /** Confidence in the estimate below, derived from volume/recency of evidence. */
  confidence: Confidence;
  /**
   * Short natural-language summary derived from the most recent observations.
   * Explicitly an inference — never presented as a measured score.
   */
  estimate: string | null;
  /** Direction of change vs. the prior window. Always an inference. */
  trend: Trend;
  /** Most recent observation excerpts backing the estimate. */
  evidence: string[];
  /** True once there is at least one observation for this dimension. */
  hasData: boolean;
}

function confidenceFromCount(count: number): Confidence {
  if (count >= 8) return "HIGH";
  if (count >= 3) return "MEDIUM";
  return "LOW";
}

function computeTrend(recent: Observation[], previous: Observation[]): Trend {
  if (recent.length === 0 && previous.length === 0) return "unknown";
  if (previous.length === 0) return "unknown";
  const delta = recent.length - previous.length;
  if (Math.abs(delta) <= 1) return "stable";
  return delta > 0 ? "improving" : "declining";
}

/**
 * Builds the current cognitive profile for a user: one entry per dimension,
 * each clearly separating observed volume (fact) from the derived estimate
 * and trend (inference). Dimensions with no observations report an explicit
 * "no data yet" state rather than a fabricated default.
 */
export async function getCognitiveProfile(userId: string): Promise<DimensionProfile[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const observations = await db.observation.findMany({
    where: { userId, createdAt: { gte: previousSince } },
    orderBy: { createdAt: "desc" },
  });

  const allTimeCounts = await db.observation.groupBy({
    by: ["dimension"],
    where: { userId },
    _count: { _all: true },
  });
  const countByDimension = new Map(allTimeCounts.map((row) => [row.dimension, row._count._all]));

  return DIMENSIONS.map((dimension) => {
    const dimObservations = observations.filter((o) => o.dimension === dimension);
    const recent = dimObservations.filter((o) => o.createdAt >= since);
    const previous = dimObservations.filter((o) => o.createdAt < since);
    const observationCount = countByDimension.get(dimension) ?? 0;

    return {
      dimension,
      observationCount,
      confidence: confidenceFromCount(observationCount),
      estimate: recent[0]?.content ?? previous[0]?.content ?? null,
      trend: computeTrend(recent, previous),
      evidence: dimObservations.slice(0, 3).map((o) => o.content),
      hasData: observationCount > 0,
    } satisfies DimensionProfile;
  });
}
