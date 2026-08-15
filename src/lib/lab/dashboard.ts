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
    recentSuits,
    recentExperiments,
    recentSimRuns,
    recentEvents,
  ] = await Promise.all([
    db.labSuit.count({ where: { userId } }),
    db.labGadget.count({ where: { userId } }),
    db.labMaterial.count({ where: { OR: [{ userId: null }, { userId }] } }),
    db.labExperiment.count({ where: { userId } }),
    db.labExperiment.count({ where: { userId, status: "RUNNING" } }),
    db.labSimulationRun.count({ where: { simulation: { userId } } }),
    db.labProject.count({ where: { userId } }),
    db.labTrainingSession.count({ where: { userId } }),
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
    },
    recentSuits,
    recentExperiments,
    recentSimRuns,
    recentEvents,
  };
}
