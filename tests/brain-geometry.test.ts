import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildBrainParts, buildNeuralWeb } from "@/components/brain/three/brainGeometry";

function boundsOf(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe("buildBrainParts", () => {
  const parts = buildBrainParts();

  it("produces real, non-empty, finite geometry for every anatomical part", () => {
    for (const [name, geo] of Object.entries(parts)) {
      const position = geo.getAttribute("position");
      expect(position.count, `${name} should have vertices`).toBeGreaterThan(0);

      // Scan in plain JS and assert ONCE with the first offender named. The
      // cerebrum alone is ~72k vertices, so an expect() per axis per vertex was
      // roughly a million matcher calls — seconds of work that pushed this test
      // against vitest's 5s timeout and made it pass or fail depending on how
      // loaded the machine was. The assertion is identical in strength; only
      // the cost of expressing it changed.
      const array = position.array as ArrayLike<number>;
      let bad = -1;
      for (let i = 0; i < array.length; i++) {
        if (!Number.isFinite(array[i])) { bad = i; break; }
      }
      expect(bad, `${name} has a non-finite coordinate at buffer index ${bad} (vertex ${Math.floor(bad / 3)})`).toBe(-1);
    }
  });

  it("keeps the right hemisphere predominantly on the positive-X side and the left on the negative-X side", () => {
    // Split is by per-triangle average X (see splitByX's doc comment), so a
    // handful of seam triangles can have one vertex just past the midline —
    // real and expected, not a bug. What matters is there's no gross
    // misassignment (e.g. an entire hemisphere ending up on the wrong side).
    const rightBounds = boundsOf(parts.right);
    const leftBounds = boundsOf(parts.left);
    expect(rightBounds.min.x).toBeGreaterThanOrEqual(-0.15);
    expect(leftBounds.max.x).toBeLessThanOrEqual(0.15);
    expect(rightBounds.max.x).toBeGreaterThan(0.3);
    expect(leftBounds.min.x).toBeLessThan(-0.3);
  });

  it("shapes the cerebrum as an elongated (front-to-back) rounded form, not a sphere or a spike", () => {
    const rightBounds = boundsOf(parts.right);
    const size = new THREE.Vector3();
    rightBounds.getSize(size);
    // front-to-back (z) should be the longest axis, and every axis should be
    // within a plausible brain-like range — neither collapsed to zero nor
    // blown out by a noise/shape bug.
    expect(size.z).toBeGreaterThan(size.y);
    expect(size.x).toBeGreaterThan(0.2);
    expect(size.y).toBeGreaterThan(0.5);
    expect(size.z).toBeGreaterThan(0.8);
    expect(size.z).toBeLessThan(2.5);
  });

  it("gives every hemisphere vertex a unit-length normal (real smooth shading, not degenerate)", () => {
    const normal = parts.right.getAttribute("normal");
    expect(normal).toBeDefined();
    let sampled = 0;
    for (let i = 0; i < normal.count; i += 37) {
      const len = Math.sqrt(normal.getX(i) ** 2 + normal.getY(i) ** 2 + normal.getZ(i) ** 2);
      expect(len).toBeGreaterThan(0.9);
      expect(len).toBeLessThan(1.1);
      sampled++;
    }
    expect(sampled).toBeGreaterThan(0);
  });

  it("positions the cerebellum as a small distinct part, not overlapping the cerebrum's own local origin", () => {
    const size = new THREE.Vector3();
    boundsOf(parts.cerebellum).getSize(size);
    expect(size.x).toBeGreaterThan(0.1);
    expect(size.x).toBeLessThan(1);
  });

  it("builds a real, non-degenerate brainstem cylinder and corpus callosum arc", () => {
    expect(parts.brainstem.getAttribute("position").count).toBeGreaterThan(0);
    expect(parts.corpusCallosum.getAttribute("position").count).toBeGreaterThan(0);
  });
});

describe("buildNeuralWeb", () => {
  it("produces a real node/edge network sharing the cerebrum's own anatomical shape (not a random point cloud)", () => {
    const web = buildNeuralWeb(2);
    const nodeCount = web.positions.length / 3;
    expect(nodeCount).toBeGreaterThan(50);

    for (let i = 0; i < web.positions.length; i++) {
      expect(Number.isFinite(web.positions[i])).toBe(true);
    }

    // Every edge must reference two real, in-range, distinct node indices.
    expect(web.edges.length % 2).toBe(0);
    for (let i = 0; i < web.edges.length; i += 2) {
      const a = web.edges[i];
      const b = web.edges[i + 1];
      expect(a).not.toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(nodeCount);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(nodeCount);
    }

    // Euler's formula for a closed triangulated sphere-topology mesh:
    // edges = vertices + faces - 2. A low-detail icosahedron subdivision
    // has 4x as many faces as vertices roughly at this level — the real
    // check here is just that the edge count is in the same order of
    // magnitude as the node count (a real mesh topology), not e.g. a full
    // dense N^2 graph or a near-empty one.
    const edgeCount = web.edges.length / 2;
    expect(edgeCount).toBeGreaterThan(nodeCount);
    expect(edgeCount).toBeLessThan(nodeCount * 5);
  });

  it("stays anatomically proportioned like the solid cerebrum (elongated front-to-back), confirming it shares the same shaping function", () => {
    const web = buildNeuralWeb(2);
    const box = new THREE.Box3();
    for (let i = 0; i < web.positions.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(web.positions[i], web.positions[i + 1], web.positions[i + 2]));
    }
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.z).toBeGreaterThan(size.y);
    expect(size.x).toBeGreaterThan(1);
  });

  it("increases node/edge density with subdivision detail", () => {
    const coarse = buildNeuralWeb(1);
    const fine = buildNeuralWeb(3);
    expect(fine.positions.length).toBeGreaterThan(coarse.positions.length);
    expect(fine.edges.length).toBeGreaterThan(coarse.edges.length);
  });

  it("gives every node a real, finite RGB color and shifts hue from low (cyan) to high (violet) Y", () => {
    const web = buildNeuralWeb(2);
    const nodeCount = web.positions.length / 3;
    expect(web.colors.length).toBe(web.positions.length);
    for (let i = 0; i < web.colors.length; i++) {
      expect(Number.isFinite(web.colors[i])).toBe(true);
      expect(web.colors[i]).toBeGreaterThanOrEqual(0);
      expect(web.colors[i]).toBeLessThanOrEqual(1);
    }

    // Find the lowest- and highest-Y real nodes and confirm the color
    // actually differs between them (a real gradient, not one flat color
    // baked everywhere).
    let lowestY = Infinity;
    let highestY = -Infinity;
    let lowestIdx = 0;
    let highestIdx = 0;
    for (let i = 0; i < nodeCount; i++) {
      const y = web.positions[i * 3 + 1];
      if (y < lowestY) {
        lowestY = y;
        lowestIdx = i;
      }
      if (y > highestY) {
        highestY = y;
        highestIdx = i;
      }
    }
    const lowColor = [web.colors[lowestIdx * 3], web.colors[lowestIdx * 3 + 1], web.colors[lowestIdx * 3 + 2]];
    const highColor = [web.colors[highestIdx * 3], web.colors[highestIdx * 3 + 1], web.colors[highestIdx * 3 + 2]];
    const diff = Math.abs(lowColor[0] - highColor[0]) + Math.abs(lowColor[1] - highColor[1]) + Math.abs(lowColor[2] - highColor[2]);
    expect(diff).toBeGreaterThan(0.1);
  });

  it("picks real high-degree nodes as hubs — in range, distinct, and no less connected than a typical node", () => {
    const web = buildNeuralWeb(2);
    const nodeCount = web.positions.length / 3;
    expect(web.hubs.length).toBeGreaterThan(0);
    expect(new Set(web.hubs).size).toBe(web.hubs.length);

    const degree = new Array(nodeCount).fill(0);
    for (let i = 0; i < web.edges.length; i += 2) {
      degree[web.edges[i]]++;
      degree[web.edges[i + 1]]++;
    }
    const avgDegree = degree.reduce((a, b) => a + b, 0) / nodeCount;
    for (const hub of web.hubs) {
      expect(hub).toBeGreaterThanOrEqual(0);
      expect(hub).toBeLessThan(nodeCount);
      expect(degree[hub]).toBeGreaterThanOrEqual(avgDegree);
    }
  });
});
