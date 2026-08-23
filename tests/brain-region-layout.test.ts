import { describe, it, expect } from "vitest";
import { fibonacciSpherePoints, computeSatelliteOffsets, SATELLITE_REVEAL_CAP } from "@/components/brain/three/regionLayout";
import { SYSTEM_ORDER, SYSTEM_OF, SYSTEM_ANCHOR, SYSTEM_COLOR, SYSTEM_LABEL } from "@/components/brain/three/anatomy";
import type { BrainNodeType } from "@/lib/brain/graph";

describe("fibonacciSpherePoints", () => {
  it("returns the requested number of points at the given radius", () => {
    const points = fibonacciSpherePoints(10, 0.2);
    expect(points).toHaveLength(10);
    for (const [x, y, z] of points) {
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(0.2, 5);
    }
  });

  it("handles 0 and 1 points without dividing by zero", () => {
    expect(fibonacciSpherePoints(0, 1)).toEqual([]);
    expect(fibonacciSpherePoints(1, 1)).toEqual([[0, 0, 1]]);
  });
});

describe("computeSatelliteOffsets", () => {
  it("returns one offset per real entity up to the reveal cap", () => {
    expect(computeSatelliteOffsets(5)).toHaveLength(5);
    expect(computeSatelliteOffsets(SATELLITE_REVEAL_CAP + 12)).toHaveLength(SATELLITE_REVEAL_CAP);
  });

  it("keeps satellites close to their region anchor (small halo, not a distant cluster)", () => {
    const offsets = computeSatelliteOffsets(8);
    for (const [x, y, z] of offsets) {
      const distance = Math.sqrt(x * x + y * y + z * z);
      expect(distance).toBeLessThan(0.35);
    }
  });
});

describe("anatomy taxonomy", () => {
  it("assigns every real BrainNodeType to exactly one of the 8 systems", () => {
    const types: BrainNodeType[] = [
      "OBJECTIVE", "OPPORTUNITY", "PROJECT", "TASK", "RESEARCH", "PROPOSAL", "CONNECTION", "MEMORY", "AGENT_RUN", "SUPERVISOR_RUN", "ECONOMIC_ASSET",
    ];
    for (const type of types) {
      expect(SYSTEM_ORDER).toContain(SYSTEM_OF[type]);
    }
  });

  it("gives every system a real anchor point, color, and label", () => {
    for (const system of SYSTEM_ORDER) {
      expect(SYSTEM_ANCHOR[system]).toHaveLength(3);
      expect(SYSTEM_COLOR[system]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SYSTEM_LABEL[system]).toBeTruthy();
    }
  });

  it("keeps every anchor near the brain's own surface, not floating far away", () => {
    for (const system of SYSTEM_ORDER) {
      const [x, y, z] = SYSTEM_ANCHOR[system];
      const distance = Math.sqrt(x * x + y * y + z * z);
      expect(distance).toBeGreaterThan(0.3);
      expect(distance).toBeLessThan(1.3);
    }
  });
});
