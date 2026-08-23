import type { Vec3 } from "@/components/brain/three/anatomy";

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

// A revealed region's real entities cluster in a small halo just off the
// brain's surface near that region's anchor — never more than this many
// individually rendered at once; the real remainder is reported honestly
// via SystemAnchor-style overflow counts rather than silently dropped.
export const SATELLITE_REVEAL_CAP = 20;

export function computeSatelliteOffsets(count: number): Vec3[] {
  const shown = Math.min(count, SATELLITE_REVEAL_CAP);
  const radius = 0.16 + Math.min(0.14, Math.log2(shown + 1) * 0.045);
  return fibonacciSpherePoints(shown, radius);
}
