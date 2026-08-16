import { db } from "@/lib/db";

/** Real aggregate counts + recent activity for the Laboratory home screen —
 * every number here is a live query, never a placeholder. */
export async function getLabDashboard(userId: string) {
  const [
    suitCount,
    gadgetCount,
    materialCount,
    experimentCount,
    activeExperiments,
    simulationRunCount,
    projectCount,
    trainingSessionCount,
    researchItemCount,
    recentSuits,
    recentExperiments,
    recentSimRuns,
    recentEvents,
    featuredSuit,
  ] = await Promise.all([
    db.labSuit.count({ where: { userId } }),
    db.labGadget.count({ where: { userId } }),
    db.labMaterial.count({ where: { OR: [{ userId: null }, { userId }] } }),
    db.labExperiment.count({ where: { userId } }),
    db.labExperiment.count({ where: { userId, status: "RUNNING" } }),
    db.labSimulationRun.count({ where: { simulation: { userId } } }),
    db.labProject.count({ where: { userId } }),
    db.labTrainingSession.count({ where: { userId } }),
    db.labResearchItem.count({ where: { userId } }),
    db.labSuit.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.labExperiment.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.labSimulationRun.findMany({
      where: { simulation: { userId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { simulation: true },
    }),
    db.event.findMany({
      where: { userId, type: { startsWith: "lab." } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    // Most recently updated suit, with its current version's stats — powers
    // the dashboard's central holographic core preview. Real state, not a
    // placeholder suit: null when the user has no suits yet.
    db.labSuit.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { currentVersion: { include: { stats: true } } },
    }),
  ]);

  return {
    counts: {
      suits: suitCount,
      gadgets: gadgetCount,
      materials: materialCount,
      experiments: experimentCount,
      activeExperiments,
      simulationRuns: simulationRunCount,
      projects: projectCount,
      trainingSessions: trainingSessionCount,
      researchItems: researchItemCount,
    },
    recentSuits,
    recentExperiments,
    recentSimRuns,
    recentEvents,
    featuredSuit,
  };
}

/** Recent failed simulation runs (structured failure analysis attached) —
 * feeds the dashboard's Warnings panel. Empty array when nothing has
 * failed, never a fabricated warning. */
export async function getRecentFailures(userId: string) {
  return db.labSimulationRun.findMany({
    where: { simulation: { userId }, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { simulation: true },
  });
}
