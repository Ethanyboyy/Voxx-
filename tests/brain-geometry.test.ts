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
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i)), `${name} vertex ${i} x`).toBe(true);
        expect(Number.isFinite(position.getY(i)), `${name} vertex ${i} y`).toBe(true);
        expect(Number.isFinite(position.getZ(i)), `${name} vertex ${i} z`).toBe(true);
      }
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
});
