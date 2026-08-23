import * as THREE from "three";
import { ridgedNoise3D } from "@/components/brain/three/noise";

/**
 * Procedural anatomical brain geometry. There is no bundled/licensed
 * anatomical scan asset in this project (no image/3D-asset generation tool
 * available, and fetching an unverified third-party model at runtime or
 * build time is exactly what the brief prohibits) — so this builds the best
 * real, deterministic, locally-generated substitute: a deformed-ellipsoid
 * cerebrum split into two hemispheres with a longitudinal fissure, lobe
 * bulges, and ridged-noise cortical folding, plus a cerebellum, brainstem,
 * and corpus callosum as separate real geometries (not a single blob).
 * This is explicitly a stylized computational-anatomy approximation, not a
 * medical-grade model — see the module doc in anatomy.ts for the same
 * disclosure applied to the system→region mapping.
 */

const CEREBRUM_SCALE: [number, number, number] = [0.72, 0.58, 0.95];
const CEREBELLUM_SCALE: [number, number, number] = [0.34, 0.24, 0.3];

/**
 * THREE.IcosahedronGeometry (like all PolyhedronGeometry subclasses) builds
 * a NON-indexed buffer — every triangle owns three unique position entries,
 * even at shared edges — so computeVertexNormals() can't average across
 * neighbors (it degrades to flat per-face normals) and there's no index
 * buffer for splitByX to group triangles by. This welds coincident
 * positions (exact matches, since all duplicates come from the same
 * original vertex before any displacement) into a real indexed geometry —
 * a small local equivalent of three/examples' BufferGeometryUtils.mergeVertices,
 * written locally rather than importing that untyped example path.
 */
function weldGeometry(geometry: THREE.BufferGeometry, precision = 5): THREE.BufferGeometry {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const hashToIndex = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(precision)}_${y.toFixed(precision)}_${z.toFixed(precision)}`;
    let index = hashToIndex.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      hashToIndex.set(key, index);
      positions.push(x, y, z);
    }
    indices.push(index);
  }

  const welded = new THREE.BufferGeometry();
  welded.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  welded.setIndex(indices);
  return welded;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Per-direction radius multiplier: lobe bulges (frontal/temporal), occipital taper, longitudinal fissure groove. Operates on the unit sphere direction, before ellipsoid scaling. */
function cerebrumShapeFactor(nx: number, ny: number, nz: number): number {
  const frontalBulge = smoothstep(0.3, 0.9, nz) * 0.16;
  const occipitalTaper = -0.2 * smoothstep(0.3, 0.85, -nz);
  const temporalBulge = 0.13 * smoothstep(-0.1, 0.5, -ny) * smoothstep(0.3, 0.8, Math.abs(nx));
  const parietalLift = 0.06 * smoothstep(0.3, 0.75, ny) * smoothstep(-0.4, 0.2, -nz) * smoothstep(-0.2, 0.4, nz);

  // A deep, narrow groove — real longitudinal-fissure depth, not a shallow
  // dimple — so the two hemispheres read as visibly distinct lobes even
  // before Dissect mode pulls them apart further.
  const fissureSigma = 0.085;
  const fissureDepth = 0.3 * smoothstep(-0.45, 0.1, ny);
  const fissure = -fissureDepth * Math.exp(-(nx * nx) / (2 * fissureSigma * fissureSigma));

  return frontalBulge + occipitalTaper + temporalBulge + parietalLift + fissure;
}

function displaceCortex(geometry: THREE.BufferGeometry, scale: [number, number, number], shapeFactor: (nx: number, ny: number, nz: number) => number, foldFreq: number, foldAmplitude: number) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const [sx, sy, sz] = scale;

  for (let i = 0; i < position.count; i++) {
    const nx = position.getX(i);
    const ny = position.getY(i);
    const nz = position.getZ(i);
    // position starts on the unit sphere (icosahedron radius 1), so (nx,ny,nz) is already the direction.
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const dx = nx / len;
    const dy = ny / len;
    const dz = nz / len;

    const shape = shapeFactor(dx, dy, dz);
    // Two noise octave BANDS rather than one: a coarse, low-frequency pass
    // for large rolling folds (the shapes an eye reads as "lobes"), and a
    // finer, higher-frequency pass layered on top at low amplitude for the
    // smaller gyri/sulci texture — a single mid-frequency band at this mesh
    // resolution reads as faceted "rock," not organic brain surface.
    const coarse = ridgedNoise3D(dx * foldFreq, dy * foldFreq, dz * foldFreq, 3, 1.9, 0.5);
    const fine = ridgedNoise3D(dx * foldFreq * 3.4, dy * foldFreq * 3.4, dz * foldFreq * 3.4, 2, 1.8, 0.5);
    const foldSigned = (coarse - 0.5) * 2 * foldAmplitude + (fine - 0.5) * 2 * foldAmplitude * 0.35;

    // A small lateral push away from the midline near the fissure — turns
    // the radius dip into an actual visible GAP between hemispheres, not
    // just a shallower dent that can read as one continuous blob head-on.
    const fissureSigma = 0.085;
    const fissureWidth = Math.exp(-(dx * dx) / (2 * fissureSigma * fissureSigma)) * smoothstep(-0.45, 0.1, dy);
    const lateralPush = Math.sign(dx || 1) * fissureWidth * 0.05;

    const radius = 1 + shape + foldSigned;
    position.setXYZ(i, dx * radius * sx + lateralPush, dy * radius * sy, dz * radius * sz);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Splits an indexed, already-smooth-normaled geometry into two non-indexed
 * geometries by triangle-average X sign — the natural hemisphere seam sits
 * inside the fissure groove already carved by cerebrumShapeFactor, so no
 * visible gap or overlap results. Carries over the SOURCE geometry's
 * already-computed smooth per-vertex normals rather than recomputing flat
 * per-face normals on the (necessarily non-indexed) output — recomputing
 * here would undo the smooth-shading work displaceCortex already did.
 */
function splitByX(geometry: THREE.BufferGeometry): { positiveX: THREE.BufferGeometry; negativeX: THREE.BufferGeometry } {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  if (!index) throw new Error("splitByX requires an indexed geometry");

  const positivePos: number[] = [];
  const positiveNorm: number[] = [];
  const negativePos: number[] = [];
  const negativeNorm: number[] = [];

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const avgX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const targetPos = avgX >= 0 ? positivePos : negativePos;
    const targetNorm = avgX >= 0 ? positiveNorm : negativeNorm;
    for (const vi of [a, b, c]) {
      targetPos.push(position.getX(vi), position.getY(vi), position.getZ(vi));
      targetNorm.push(normal.getX(vi), normal.getY(vi), normal.getZ(vi));
    }
  }

  function build(coords: number[], normals: number[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }

  return { positiveX: build(positivePos, positiveNorm), negativeX: build(negativePos, negativeNorm) };
}

export interface BrainParts {
  /** +X side */
  right: THREE.BufferGeometry;
  /** -X side */
  left: THREE.BufferGeometry;
  cerebellum: THREE.BufferGeometry;
  brainstem: THREE.BufferGeometry;
  corpusCallosum: THREE.BufferGeometry;
}

export function buildBrainParts(): BrainParts {
  const cerebrumRaw = new THREE.IcosahedronGeometry(1, 5);
  const cerebrumBase = weldGeometry(cerebrumRaw);
  cerebrumRaw.dispose();
  displaceCortex(cerebrumBase, CEREBRUM_SCALE, cerebrumShapeFactor, 2.6, 0.042);
  const { positiveX: right, negativeX: left } = splitByX(cerebrumBase);
  cerebrumBase.dispose();

  const cerebellumRaw = new THREE.IcosahedronGeometry(1, 4);
  const cerebellumGeo = weldGeometry(cerebellumRaw);
  cerebellumRaw.dispose();
  displaceCortex(cerebellumGeo, CEREBELLUM_SCALE, () => 0, 6.5, 0.05);

  const brainstem = new THREE.CylinderGeometry(0.15, 0.21, 0.5, 14, 3);
  brainstem.computeVertexNormals();

  const corpusCallosum = new THREE.TorusGeometry(0.27, 0.045, 8, 28, Math.PI);
  corpusCallosum.computeVertexNormals();

  return { right, left, cerebellum: cerebellumGeo, brainstem, corpusCallosum };
}
