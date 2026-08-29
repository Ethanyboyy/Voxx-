import { db } from "@/lib/db";
import { difficultyFactor, runSimulation } from "@/lib/lab/physics";
import { recordEvent } from "@/lib/observability/events";
import { recordSimulationRunExperience } from "@/lib/lab/learning";
import { scopeObjectiveId } from "@/lib/cognition/experience";

export interface CreateSimulationInput {
  userId: string;
  projectId?: string;
  name: string;
  scenarioId: string;
  suitId?: string;
  webProfileId?: string;
  gadgetIds?: string[];
  userMassKg?: number;
  reactionTimeMs?: number;
  skillLevel?: number;
  /** The Objective this simulation is being run in pursuit of. A simulated
   *  result stays a model output whichever objective it serves. */
  objectiveId?: string;
}

export async function createSimulation(input: CreateSimulationInput) {
  const simulation = await db.labSimulation.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      scenarioId: input.scenarioId,
      suitId: input.suitId,
      webProfileId: input.webProfileId,
      userMassKg: input.userMassKg ?? 75,
      reactionTimeMs: input.reactionTimeMs ?? 250,
      skillLevel: input.skillLevel ?? 50,
      // Stored on the simulation itself so the objective association is
      // durable, independent of the best-effort graph write.
      objectiveId: await scopeObjectiveId(input.userId, input.objectiveId),
      gadgets: input.gadgetIds
        ? { create: input.gadgetIds.map((gadgetId) => ({ gadgetId })) }
        : undefined,
    },
  });
  return simulation;
}

export async function listSimulations(userId: string, projectId?: string) {
  return db.labSimulation.findMany({
    where: { userId, projectId },
    include: {
      scenario: true,
      suit: { include: { currentVersion: { include: { stats: true } } } },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getSimulation(userId: string, id: string) {
  return db.labSimulation.findFirst({
    where: { id, userId },
    include: {
      scenario: true,
      suit: { include: { currentVersion: { include: { stats: true } } } },
      webProfile: true,
      gadgets: { include: { gadget: { include: { currentVersion: { include: { stats: true } } } } } },
      runs: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Executes the deterministic kinematic model for a saved LabSimulation and
 * persists the resulting telemetry as a LabSimulationRun. */
export async function executeSimulation(userId: string, simulationId: string, seed?: number) {
  const simulation = await db.labSimulation.findFirst({
    where: { id: simulationId, userId },
    include: {
      scenario: true,
      suit: { include: { currentVersion: { include: { stats: true } } } },
      gadgets: { include: { gadget: { include: { currentVersion: { include: { stats: true } } } } } },
    },
  });
  if (!simulation) return null;

  const suitStats = simulation.suit?.currentVersion?.stats;
  const gadgetMassKg = simulation.gadgets.reduce(
    (sum, g) => sum + (g.gadget.currentVersion?.stats?.massKg ?? 0),
    0
  );
  const gadgetPowerW = simulation.gadgets.reduce(
    (sum, g) => sum + (g.gadget.currentVersion?.stats?.powerRequirementW ?? 0),
    0
  );

  const equipmentMassKg = (suitStats?.weightKg ?? 3) + gadgetMassKg;
  const runSeed = seed ?? Math.floor(Math.random() * 1_000_000);
  const durationS = 20;

  const result = runSimulation({
    seed: runSeed,
    durationS,
    gravityMs2: simulation.scenario.gravityMs2,
    windMs: simulation.scenario.windMs,
    temperatureC: simulation.scenario.temperatureC,
    elevationM: simulation.scenario.elevationM,
    obstacleCount: simulation.scenario.obstacleCount,
    difficultyFactor: difficultyFactor(simulation.scenario.difficulty),
    userMassKg: simulation.userMassKg,
    equipmentMassKg,
    mobility: suitStats?.mobility ?? 50,
    thermalLoadBaselineC: suitStats?.thermalLoadC ?? 30,
    energyRequirementW: (suitStats?.energyRequirementW ?? 0) + gadgetPowerW,
    reactionTimeMs: simulation.reactionTimeMs,
    skillLevel: simulation.skillLevel,
  });

  const hasFailures = result.failures.length > 0;
  const run = await db.labSimulationRun.create({
    data: {
      simulationId,
      status: hasFailures ? "FAILED" : "COMPLETED",
      seed: runSeed,
      durationS,
      telemetry: JSON.stringify(result.telemetry),
      peakVelocityMs: result.peakVelocityMs,
      peakForceN: result.peakForceN,
      peakThermalLoadC: result.peakThermalLoadC,
      fatigueEstimatePct: result.fatigueEstimatePct,
      warnings: JSON.stringify(result.warnings),
      failureAnalysis: JSON.stringify(result.failures),
      summary: `Peak velocity ${result.peakVelocityMs.toFixed(1)} m/s, peak force ${result.peakForceN.toFixed(0)} N, fatigue ${result.fatigueEstimatePct.toFixed(0)}%.`,
      completedAt: new Date(),
    },
  });

  await recordEvent({
    userId,
    type: hasFailures ? "lab.simulation.failed" : "lab.simulation.completed",
    payload: { name: simulation.name, runId: run.id, failureCategories: result.failures.map((f) => f.category) },
    subjectType: "LabSimulation",
    subjectId: simulationId,
  });

  // The telemetry is real and deterministic, and it is a model's output. It
  // now becomes durable knowledge — with the seed and every modeled input, so
  // the run is reproducible from the memory alone, and framed unambiguously
  // as a simulation so no later reader can mistake it for a physical result.
  await recordSimulationRunExperience({
    userId,
    simulationId,
    simulationName: simulation.name,
    runId: run.id,
    scenarioName: simulation.scenario.name,
    seed: runSeed,
    durationS,
    inputs: {
      gravityMs2: simulation.scenario.gravityMs2,
      windMs: simulation.scenario.windMs,
      temperatureC: simulation.scenario.temperatureC,
      elevationM: simulation.scenario.elevationM,
      obstacleCount: simulation.scenario.obstacleCount,
      difficulty: simulation.scenario.difficulty,
      userMassKg: simulation.userMassKg,
      equipmentMassKg,
      mobility: suitStats?.mobility ?? 50,
      reactionTimeMs: simulation.reactionTimeMs,
      skillLevel: simulation.skillLevel,
    },
    measurements: {
      peakVelocityMs: result.peakVelocityMs,
      peakForceN: result.peakForceN,
      peakThermalLoadC: result.peakThermalLoadC,
      fatigueEstimatePct: result.fatigueEstimatePct,
    },
    warnings: result.warnings,
    failures: result.failures,
    // Taken from the simulation record, not from the caller of this run.
    objectiveId: simulation.objectiveId,
    suitName: simulation.suit ? `${simulation.suit.codename} ${simulation.suit.designation}` : null,
  });

  return run;
}

export async function getSimulationRun(userId: string, runId: string) {
  const run = await db.labSimulationRun.findFirst({
    where: { id: runId, simulation: { userId } },
    include: { simulation: { include: { scenario: true, suit: true } } },
  });
  return run;
}
