import { describe, it, expect } from "vitest";
import { runSimulation, computeWebLoadModel, difficultyFactor } from "@/lib/lab/physics";

const BASE_INPUTS = {
  seed: 42,
  durationS: 10,
  gravityMs2: 9.81,
  windMs: 2,
  temperatureC: 20,
  elevationM: 10,
  obstacleCount: 4,
  difficultyFactor: 0.45,
  userMassKg: 75,
  equipmentMassKg: 5,
  mobility: 60,
  thermalLoadBaselineC: 30,
  energyRequirementW: 25,
  reactionTimeMs: 250,
  skillLevel: 50,
};

describe("lab physics — deterministic simulation model", () => {
  it("produces identical telemetry for the same seed (determinism)", () => {
    const a = runSimulation(BASE_INPUTS);
    const b = runSimulation(BASE_INPUTS);
    expect(a.telemetry).toEqual(b.telemetry);
    expect(a.peakVelocityMs).toBe(b.peakVelocityMs);
    expect(a.peakForceN).toBe(b.peakForceN);
  });

  it("produces different telemetry for a different seed", () => {
    const a = runSimulation(BASE_INPUTS);
    const b = runSimulation({ ...BASE_INPUTS, seed: 999 });
    expect(a.telemetry).not.toEqual(b.telemetry);
  });

  it("always includes the mandatory simulation-only disclaimer", () => {
    const result = runSimulation(BASE_INPUTS);
    expect(result.warnings.some((w) => w.includes("SIMULATION ONLY"))).toBe(true);
  });

  it("keeps velocity non-negative and force non-negative throughout the run", () => {
    const result = runSimulation(BASE_INPUTS);
    for (const sample of result.telemetry) {
      expect(sample.velocityMs).toBeGreaterThanOrEqual(0);
      expect(sample.forceN).toBeGreaterThanOrEqual(0);
    }
  });

  it("higher equipment mass increases peak force for an otherwise identical run", () => {
    const light = runSimulation({ ...BASE_INPUTS, equipmentMassKg: 2 });
    const heavy = runSimulation({ ...BASE_INPUTS, equipmentMassKg: 20 });
    expect(heavy.peakForceN).toBeGreaterThan(light.peakForceN);
  });

  it("maps difficulty labels to an increasing 0-1 factor", () => {
    expect(difficultyFactor("BEGINNER")).toBeLessThan(difficultyFactor("INTERMEDIATE"));
    expect(difficultyFactor("INTERMEDIATE")).toBeLessThan(difficultyFactor("ADVANCED"));
    expect(difficultyFactor("ADVANCED")).toBeLessThan(difficultyFactor("EXPERIMENTAL"));
  });
});

describe("lab physics — web load model", () => {
  it("computes static load as simple weight (F=mg) when velocity is zero", () => {
    const result = computeWebLoadModel({ userMassKg: 80, equipmentMassKg: 5, swingRadiusM: 10, velocityMs: 0 });
    expect(result.staticLoadN).toBeCloseTo(85 * 9.81, 0);
    expect(result.dynamicLoadN).toBeCloseTo(result.staticLoadN, 0);
  });

  it("increases dynamic load with velocity via the centripetal term", () => {
    const slow = computeWebLoadModel({ userMassKg: 75, equipmentMassKg: 4, swingRadiusM: 10, velocityMs: 4 });
    const fast = computeWebLoadModel({ userMassKg: 75, equipmentMassKg: 4, swingRadiusM: 10, velocityMs: 16 });
    expect(fast.dynamicLoadN).toBeGreaterThan(slow.dynamicLoadN);
  });

  it("tension always exceeds the raw dynamic force (safety allowance)", () => {
    const result = computeWebLoadModel({ userMassKg: 75, equipmentMassKg: 4, swingRadiusM: 10, velocityMs: 8 });
    expect(result.tensionN).toBeGreaterThan(result.forceN);
  });
});
