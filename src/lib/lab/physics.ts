// Spider-Man Laboratory — deterministic simulation abstraction layer.
//
// This is NOT a real physics engine (rigid-body dynamics, collision meshes,
// numerical integrators). It's a small, deterministic, seeded kinematic model
// that turns {scenario, suit, gadgets, user} into a believable telemetry time
// series so the Simulation Center has something real to run, save, and chart
// today. The interface (SimulationInputs -> SimulationResult) is the stable
// boundary a future real physics engine (e.g. a proper integrator or a
// WASM/Rust solver) would replace internally, without touching any caller.
//
// Every run is a pure function of its inputs plus `seed` (mulberry32 PRNG),
// so re-running the same simulation with the same seed reproduces identical
// telemetry — required for experiments that compare variants against a
// fixed baseline.

export interface SimulationInputs {
  seed: number;
  durationS: number;
  gravityMs2: number;
  windMs: number;
  temperatureC: number;
  elevationM: number;
  obstacleCount: number;
  difficultyFactor: number; // 0-1, from LabDifficulty
  userMassKg: number;
  equipmentMassKg: number;
  mobility: number; // 0-100 suit stat
  thermalLoadBaselineC: number; // suit stat
  energyRequirementW: number; // suit + gadgets
  reactionTimeMs: number;
  skillLevel: number; // 0-100
}

export interface TelemetrySample {
  t: number;
  positionM: number;
  velocityMs: number;
  accelerationMs2: number;
  forceN: number;
  thermalLoadC: number;
  fatiguePercent: number;
}

export type FailureCategory =
  | "EXCESSIVE_LOAD"
  | "THERMAL_OVERLOAD"
  | "INSUFFICIENT_STRUCTURAL_CAPACITY"
  | "ENERGY_LIMITATION"
  | "ENVIRONMENTAL_CONDITION"
  | "COLLISION_RISK"
  | "INSTABILITY";

export interface FailureAnalysisEntry {
  category: FailureCategory;
  explanation: string;
  suggestion: string;
}

export interface SimulationResult {
  telemetry: TelemetrySample[];
  peakVelocityMs: number;
  peakForceN: number;
  peakThermalLoadC: number;
  fatigueEstimatePct: number;
  warnings: string[];
  /** Structured "why" behind any threshold the run exceeded — never just
   * "simulation failed". Empty array when nothing exceeded a modeled
   * threshold. See master prompt §24: explain, don't just report failure. */
  failures: FailureAnalysisEntry[];
}

/** mulberry32 — tiny, fast, deterministic PRNG. Same seed -> same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runSimulation(inputs: SimulationInputs): SimulationResult {
  const rand = mulberry32(inputs.seed);
  const totalMassKg = Math.max(inputs.userMassKg + inputs.equipmentMassKg, 1);
  const sampleCount = Math.max(12, Math.min(80, Math.round(inputs.durationS * 4)));
  const dt = inputs.durationS / sampleCount;

  const mobilityFactor = inputs.mobility / 100;
  const skillFactor = inputs.skillLevel / 100;
  const dragCoefficient = 0.6 + inputs.difficultyFactor * 0.6 + inputs.windMs * 0.04 - mobilityFactor * 0.3;
  const massDragPenalty = inputs.equipmentMassKg / totalMassKg;
  const effortFrequency = 0.9 + mobilityFactor * 0.6 + skillFactor * 0.3;

  const telemetry: TelemetrySample[] = [];
  let velocity = 0;
  let position = 0;
  let peakVelocityMs = 0;
  let peakForceN = 0;
  let peakThermalLoadC = 0;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i * dt;
    const drivePhase = Math.sin(t * effortFrequency) ** 2;
    const driveAccel = (2.2 + mobilityFactor * 5.5 + skillFactor * 2) * drivePhase;
    const gravityDrop = inputs.gravityMs2 * 0.08 * Math.max(0, Math.sin(t * effortFrequency * 0.5));
    const dragAccel = dragCoefficient * (velocity * 0.18 + massDragPenalty * 1.4);
    const noise = (rand() - 0.5) * 0.6;
    const acceleration = driveAccel + gravityDrop - dragAccel + noise;

    velocity = Math.max(0, velocity + acceleration * dt);
    position += velocity * dt;

    const forceN = totalMassKg * Math.abs(acceleration);
    const activityHeat = (velocity / 10) * (inputs.energyRequirementW / 40);
    const thermalLoadC =
      inputs.temperatureC + inputs.thermalLoadBaselineC * 0.25 + activityHeat + (rand() - 0.5) * 0.4;
    const fatiguePercent = Math.min(
      100,
      Math.max(
        0,
        (t / Math.max(inputs.durationS, 0.001)) * 100 * (1 - skillFactor * 0.45) * (1 + massDragPenalty * 0.6)
      )
    );

    peakVelocityMs = Math.max(peakVelocityMs, velocity);
    peakForceN = Math.max(peakForceN, forceN);
    peakThermalLoadC = Math.max(peakThermalLoadC, thermalLoadC);

    telemetry.push({
      t: Number(t.toFixed(2)),
      positionM: Number(position.toFixed(2)),
      velocityMs: Number(velocity.toFixed(2)),
      accelerationMs2: Number(acceleration.toFixed(2)),
      forceN: Number(forceN.toFixed(1)),
      thermalLoadC: Number(thermalLoadC.toFixed(1)),
      fatiguePercent: Number(fatiguePercent.toFixed(1)),
    });
  }

  const fatigueEstimatePct = telemetry[telemetry.length - 1]?.fatiguePercent ?? 0;

  const warnings: string[] = [];
  const gForceEquivalent = peakForceN / (totalMassKg * inputs.gravityMs2);
  if (gForceEquivalent > 4.5) {
    warnings.push(
      `Peak dynamic load is ~${gForceEquivalent.toFixed(1)}g — this is a SIMULATED estimate only, not a real-world safety validation.`
    );
  }
  if (peakThermalLoadC > 42) {
    warnings.push(`Peak simulated thermal load reached ${peakThermalLoadC.toFixed(1)}°C — approaching thermal-stress range.`);
  }
  if (fatigueEstimatePct > 80) {
    warnings.push("Simulated fatigue estimate exceeds 80% by end of run — sustained performance would likely degrade.");
  }
  if (inputs.obstacleCount > 6 && inputs.difficultyFactor > 0.6) {
    warnings.push("High obstacle density at this difficulty — collision risk not modeled by this kinematic simulation.");
  }
  warnings.push(
    "SIMULATION ONLY: results are a deterministic model output, not real-world engineering validation. See Web Lab and ARCHITECTURE.md."
  );

  const failures: FailureAnalysisEntry[] = [];
  if (gForceEquivalent > 6) {
    failures.push({
      category: "EXCESSIVE_LOAD",
      explanation: `Peak dynamic force reached ~${gForceEquivalent.toFixed(1)}g relative to total mass — beyond the model's assumed sustainable-load range.`,
      suggestion: "Reduce equipment mass, lower scenario difficulty, or increase suit mobility to soften acceleration bursts.",
    });
  }
  if (peakThermalLoadC > 48) {
    failures.push({
      category: "THERMAL_OVERLOAD",
      explanation: `Simulated thermal load reached ${peakThermalLoadC.toFixed(1)}°C, above the model's 48°C sustainable-operation ceiling.`,
      suggestion: "Investigate a lower suit thermal-load baseline, better ventilation components, or a cooler-environment scenario.",
    });
  }
  if (gForceEquivalent > 5 && inputs.mobility < 40) {
    failures.push({
      category: "INSUFFICIENT_STRUCTURAL_CAPACITY",
      explanation: `Low suit mobility (${inputs.mobility}/100) combined with high dynamic load suggests the current structural layer wasn't modeled for this scenario's forces.`,
      suggestion: "Consider a structural-layer material with higher tensile strength, or test at lower difficulty first.",
    });
  }
  const energyBudgetJ = 600; // assumed baseline energy budget for a run of this length
  if (inputs.energyRequirementW * inputs.durationS > energyBudgetJ) {
    failures.push({
      category: "ENERGY_LIMITATION",
      explanation: `Estimated energy draw (${(inputs.energyRequirementW * inputs.durationS).toFixed(0)} J) exceeds the model's assumed ${energyBudgetJ} J budget for a ${inputs.durationS.toFixed(0)}s run.`,
      suggestion: "Lower gadget power draw, shorten the scenario, or flag this as a battery-capacity research item.",
    });
  }
  if (inputs.windMs > 15 || inputs.temperatureC > 45 || inputs.temperatureC < -10) {
    failures.push({
      category: "ENVIRONMENTAL_CONDITION",
      explanation: `Scenario conditions (wind ${inputs.windMs} m/s, ${inputs.temperatureC}°C) are outside the model's assumed nominal operating envelope.`,
      suggestion: "Re-run under a moderate-condition scenario to isolate whether the environment or the design is the limiting factor.",
    });
  }
  if (inputs.obstacleCount > 8 && inputs.difficultyFactor > 0.75) {
    failures.push({
      category: "COLLISION_RISK",
      explanation: `${inputs.obstacleCount} obstacles at high difficulty exceeds what this kinematic model can represent — it has no collision detection.`,
      suggestion: "Treat this run's telemetry as optimistic; a scenario this dense needs a real collision-aware simulation before drawing conclusions.",
    });
  }
  if (fatigueEstimatePct > 90 && inputs.skillLevel < 40) {
    failures.push({
      category: "INSTABILITY",
      explanation: `Fatigue reached ${fatigueEstimatePct.toFixed(0)}% with a low skill level (${inputs.skillLevel}/100) — the model treats this combination as losing controlled performance before the run ends.`,
      suggestion: "Raise skill level (more training) or reduce scenario duration/difficulty for this design.",
    });
  }

  return { telemetry, peakVelocityMs, peakForceN, peakThermalLoadC, fatigueEstimatePct, warnings, failures };
}

/** Theoretical load-model calculator for the Web Lab (section 13). Always
 * HYPOTHETICAL/ESTIMATED — never presented as a real-world safety certificate. */
export function computeWebLoadModel(input: {
  userMassKg: number;
  equipmentMassKg: number;
  swingRadiusM: number;
  velocityMs: number;
  gravityMs2?: number;
}) {
  const g = input.gravityMs2 ?? 9.81;
  const totalMassKg = input.userMassKg + input.equipmentMassKg;
  const staticLoadN = totalMassKg * g;
  const centripetalAccel = input.velocityMs ** 2 / Math.max(input.swingRadiusM, 0.1);
  const accelerationMs2 = g + centripetalAccel;
  const dynamicLoadN = totalMassKg * accelerationMs2;
  const forceN = dynamicLoadN;
  const tensionN = dynamicLoadN * 1.15; // simple line-angle safety allowance
  return {
    staticLoadN: Number(staticLoadN.toFixed(1)),
    dynamicLoadN: Number(dynamicLoadN.toFixed(1)),
    accelerationMs2: Number(accelerationMs2.toFixed(2)),
    forceN: Number(forceN.toFixed(1)),
    tensionN: Number(tensionN.toFixed(1)),
  };
}

export function difficultyFactor(difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERIMENTAL"): number {
  switch (difficulty) {
    case "BEGINNER":
      return 0.2;
    case "INTERMEDIATE":
      return 0.45;
    case "ADVANCED":
      return 0.7;
    case "EXPERIMENTAL":
      return 0.95;
  }
}
