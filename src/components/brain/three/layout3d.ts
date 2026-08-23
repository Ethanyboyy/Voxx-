import type { BrainNode } from "@/lib/brain/graph";
import { importanceOf } from "@/components/brain/importance";
import { SYSTEM_OF, SYSTEM_ORDER, type BrainSystem } from "@/components/brain/three/systems";

export type Vec3 = [number, number, number];

export const CORE_RADIUS = 0.85;
export const SYSTEM_RADIUS = 6;
export const DISSECT_RADIUS = 9.5;
export const LOCAL_CLUSTER_BASE_RADIUS = 1.5;
// Never render more than this many individual entity meshes for one
// revealed system at once — a real GPU/readability limit, not arbitrary
// hiding. Anything past the cap is dropped from the position map (so it
// renders nowhere) but its real count still reaches the caller via
// SystemAnchor.overflowCount, which the UI surfaces honestly ("+N more").
export const SYSTEM_REVEAL_CAP = 42;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** N points evenly spread across a sphere of the given radius, centered at the origin. */
export function fibonacciSpherePoints(n: number, radius: number): Vec3[] {
  if (n <= 0) return [];
  if (n === 1) return [[0, 0, radius]];
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    points.push([Math.cos(theta) * radiusAtY * radius, y * radius, Math.sin(theta) * radiusAtY * radius]);
  }
  return points;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export interface SystemAnchor {
  system: BrainSystem;
  position: Vec3;
  count: number;
  /** Real members beyond SYSTEM_REVEAL_CAP that aren't individually positioned when revealed — 0 when everything fits. */
  overflowCount: number;
}

export interface BrainLayout {
  /** One anchor per system, always present (radius reflects real member count). */
  anchors: SystemAnchor[];
  /** Per-node target position — only populated for nodes currently revealed. */
  nodePositions: Map<string, Vec3>;
}

/**
 * Pure layout function: real nodes in, target 3D positions out. No random
 * placement stands in for missing data — every position is derived from
 * (a) which system a node's real type belongs to and (b) that system's
 * member count, both from systems.ts's real taxonomy.
 *
 * - Level 0 (revealedSystems empty): anchors only, no member nodes are
 *   given a position (they're aggregated into the anchor).
 * - Focused (revealedSystems = selection's own system + its 1-hop
 *   neighbors' systems): those systems' real members fan out around their
 *   anchors; other anchors stay put and stay compact.
 * - Dissected (dissected=true, revealedSystems = all): every system's
 *   anchor moves to the wider ring and every system's real members fan out
 *   simultaneously.
 */
export function computeBrainLayout(nodes: BrainNode[], dissected: boolean, revealedSystems: ReadonlySet<BrainSystem>): BrainLayout {
  const bySystem = new Map<BrainSystem, BrainNode[]>();
  for (const system of SYSTEM_ORDER) bySystem.set(system, []);
  for (const node of nodes) {
    const system = SYSTEM_OF[node.type];
    bySystem.get(system)?.push(node);
  }

  const anchorDirections = fibonacciSpherePoints(SYSTEM_ORDER.length, 1);
  const anchors: SystemAnchor[] = [];
  const nodePositions = new Map<string, Vec3>();

  SYSTEM_ORDER.forEach((system, i) => {
    const members = bySystem.get(system) ?? [];
    const direction = anchorDirections[i];
    const revealed = dissected || revealedSystems.has(system);
    const ringRadius = dissected ? DISSECT_RADIUS : SYSTEM_RADIUS;
    const anchorPos: Vec3 = [direction[0] * ringRadius, direction[1] * ringRadius, direction[2] * ringRadius];

    const overflowCount = Math.max(0, members.length - SYSTEM_REVEAL_CAP);
    anchors.push({ system, position: anchorPos, count: members.length, overflowCount });

    if (revealed && members.length > 0) {
      const shown = overflowCount > 0 ? [...members].sort((a, b) => importanceOf(b) - importanceOf(a)).slice(0, SYSTEM_REVEAL_CAP) : members;
      const clusterRadius = LOCAL_CLUSTER_BASE_RADIUS + Math.min(1.4, Math.log2(shown.length + 1) * 0.35);
      const localPoints = fibonacciSpherePoints(shown.length, clusterRadius);
      shown.forEach((node, j) => {
        nodePositions.set(node.id, add(anchorPos, localPoints[j]));
      });
    }
  });

  return { anchors, nodePositions };
}
