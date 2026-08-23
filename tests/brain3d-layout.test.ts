import { describe, it, expect } from "vitest";
import { fibonacciSpherePoints, computeBrainLayout, SYSTEM_REVEAL_CAP } from "@/components/brain/three/layout3d";
import { SYSTEM_ORDER, SYSTEM_OF } from "@/components/brain/three/systems";
import type { BrainNode } from "@/lib/brain/graph";

function node(id: string, type: BrainNode["type"]): BrainNode {
  return { id, entityId: id, type, label: id, status: null, updatedAt: new Date().toISOString(), meta: {} };
}

describe("fibonacciSpherePoints", () => {
  it("returns the requested number of points, each at the given radius from the origin", () => {
    const points = fibonacciSpherePoints(12, 5);
    expect(points).toHaveLength(12);
    for (const [x, y, z] of points) {
      const distance = Math.sqrt(x * x + y * y + z * z);
      expect(distance).toBeCloseTo(5, 5);
    }
  });

  it("handles 0 and 1 points without dividing by zero", () => {
    expect(fibonacciSpherePoints(0, 5)).toEqual([]);
    expect(fibonacciSpherePoints(1, 5)).toEqual([[0, 0, 5]]);
  });

  it("spreads points apart rather than clustering them together", () => {
    const points = fibonacciSpherePoints(8, 1);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        const dz = points[i][2] - points[j][2];
        expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeGreaterThan(0.2);
      }
    }
  });
});

describe("computeBrainLayout", () => {
  it("always produces exactly one anchor per real system, even with zero nodes", () => {
    const layout = computeBrainLayout([], false, new Set());
    expect(layout.anchors).toHaveLength(SYSTEM_ORDER.length);
    expect(layout.anchors.every((a) => a.count === 0 && a.overflowCount === 0)).toBe(true);
    expect(layout.nodePositions.size).toBe(0);
  });

  it("keeps real member counts on each anchor without positioning them when the system isn't revealed", () => {
    const nodes = [node("o1", "OBJECTIVE"), node("o2", "OBJECTIVE"), node("m1", "MEMORY")];
    const layout = computeBrainLayout(nodes, false, new Set());
    const objectivesAnchor = layout.anchors.find((a) => a.system === "OBJECTIVES");
    expect(objectivesAnchor?.count).toBe(2);
    expect(layout.nodePositions.has("o1")).toBe(false);
    expect(layout.nodePositions.has("o2")).toBe(false);
  });

  it("positions every real member of a revealed system, clustered around its anchor", () => {
    const nodes = [node("o1", "OBJECTIVE"), node("o2", "OBJECTIVE"), node("t1", "TASK")];
    const layout = computeBrainLayout(nodes, false, new Set(["OBJECTIVES"]));
    expect(layout.nodePositions.has("o1")).toBe(true);
    expect(layout.nodePositions.has("o2")).toBe(true);
    // TASK belongs to PROJECTS, which wasn't revealed.
    expect(layout.nodePositions.has("t1")).toBe(false);

    const anchor = layout.anchors.find((a) => a.system === "OBJECTIVES")!;
    const pos = layout.nodePositions.get("o1")!;
    const dx = pos[0] - anchor.position[0];
    const dy = pos[1] - anchor.position[1];
    const dz = pos[2] - anchor.position[2];
    const distanceFromAnchor = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(distanceFromAnchor).toBeGreaterThan(0);
    expect(distanceFromAnchor).toBeLessThan(5);
  });

  it("reveals every system at once when dissected, regardless of the explicit reveal set", () => {
    const nodes = [node("o1", "OBJECTIVE"), node("m1", "MEMORY")];
    const layout = computeBrainLayout(nodes, true, new Set());
    expect(layout.nodePositions.has("o1")).toBe(true);
    expect(layout.nodePositions.has("m1")).toBe(true);
  });

  it("caps individually-positioned members per system and reports the real overflow count honestly", () => {
    const nodes = Array.from({ length: SYSTEM_REVEAL_CAP + 7 }, (_, i) => node(`m${i}`, "MEMORY"));
    const layout = computeBrainLayout(nodes, false, new Set(["MEMORY"]));
    const anchor = layout.anchors.find((a) => a.system === "MEMORY")!;
    expect(anchor.count).toBe(SYSTEM_REVEAL_CAP + 7);
    expect(anchor.overflowCount).toBe(7);
    const positioned = nodes.filter((n) => layout.nodePositions.has(n.id));
    expect(positioned).toHaveLength(SYSTEM_REVEAL_CAP);
  });

  it("assigns every real BrainNodeType to exactly one system via SYSTEM_OF (no orphaned types)", () => {
    const types: BrainNode["type"][] = [
      "OBJECTIVE", "OPPORTUNITY", "PROJECT", "TASK", "RESEARCH", "PROPOSAL", "CONNECTION", "MEMORY", "AGENT_RUN", "SUPERVISOR_RUN", "ECONOMIC_ASSET",
    ];
    for (const type of types) {
      expect(SYSTEM_ORDER).toContain(SYSTEM_OF[type]);
    }
  });
});
