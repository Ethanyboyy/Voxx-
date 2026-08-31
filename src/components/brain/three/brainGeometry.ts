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

/** Linear edge subdivision — see the note in buildBrainParts. */
const CEREBRUM_DETAIL = 48;
const CEREBELLUM_DETAIL = 22;

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
    const fine = ridgedNoise3D(dx * foldFreq * 1.6, dy * foldFreq * 1.6, dz * foldFreq * 1.6, 2, 1.7, 0.45);
    // Ridged noise is already peaked; keeping it UNSIGNED and subtracting it
    // carves sulci INTO the surface rather than rippling the radius evenly
    // above and below it. That asymmetry is what real cortex looks like —
    // broad gyral crowns separated by narrow deep grooves — and it is the
    // difference between a folded brain and a lumpy potato. The previous
    // centred `(n - 0.5) * 2` form spent half its amplitude pushing outward,
    // so at any amplitude subtle enough to keep the silhouette it produced no
    // readable grooves at all.
    // ridgedNoise3D accumulates (1 - |simplex|)^2, and simplex output clusters
    // near zero, so its practical range is roughly [0.55, 1.0] — NOT [0, 1].
    // Using `1 - value` raw therefore spends only a tenth of the requested
    // amplitude and produces a surface that measures as displaced but reads as
    // smooth. Remapping that real range to full [0, 1] first is what turns the
    // ridges into gyral crowns and the gaps into sulci deep enough to shade.
    const RIDGE_FLOOR = 0.55;
    const RIDGE_SPAN = 1 - RIDGE_FLOOR;
    // Smoothstep rather than a linear clamp: a hard clamp leaves the valley
    // floors flat-bottomed and their walls sharp, which at this resolution
    // renders as spikes rather than folds. Real gyri are rounded crowns with
    // rounded troughs.
    const crown = smoothstep(0, 1, Math.min(1, Math.max(0, (coarse - RIDGE_FLOOR) / RIDGE_SPAN)));
    const crownFine = smoothstep(0, 1, Math.min(1, Math.max(0, (fine - RIDGE_FLOOR) / RIDGE_SPAN)));
    const sulcal = (1 - crown) * 0.9 + (1 - crownFine) * 0.1;
    const foldSigned = -sulcal * foldAmplitude;

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

// The reference's holographic material reads as a cool cyan glow low in the
// brain (brainstem/cerebellum) rising into a warmer violet/magenta glow
// across the upper cortex — not one flat accent color. This is a real,
// deterministic function of vertex position (world-space Y, accounting for
// each anatomical part's own placement offset), baked once into a per-vertex
// `color` attribute rather than requiring a custom shader.
const GRADIENT_LOW = new THREE.Color("#22d3ee");
const GRADIENT_HIGH = new THREE.Color("#c084fc");
const GRADIENT_Y_MIN = -1.05;
const GRADIENT_Y_MAX = 0.95;

export function gradientColorAt(worldY: number): THREE.Color {
  const t = THREE.MathUtils.clamp((worldY - GRADIENT_Y_MIN) / (GRADIENT_Y_MAX - GRADIENT_Y_MIN), 0, 1);
  // Biased toward the high (violet) end — cyan should read as an accent
  // concentrated near the very bottom, not half the brain, matching the
  // reference's actual color balance.
  const eased = Math.pow(t, 0.55);
  return new THREE.Color().lerpColors(GRADIENT_LOW, GRADIENT_HIGH, eased);
}

/** Bakes gradientColorAt() into a `color` BufferAttribute, one call per
 * anatomical part with that part's own world-space Y placement offset so
 * the gradient reads continuously across all 5 separately-positioned parts
 * rather than each restarting its own local gradient. */
export function applyGradientVertexColors(geometry: THREE.BufferGeometry, worldYOffset: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    c.copy(gradientColorAt(position.getY(i) + worldYOffset));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
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

export interface NeuralWeb {
  /** One [x,y,z] triple per node — real anatomically-shaped points, not random scatter. */
  positions: Float32Array;
  /** Pairs of node indices — the mesh's own real triangle-edge topology at this resolution, not an arbitrary/random graph. */
  edges: Uint32Array;
  /** One [r,g,b] triple per node — the same world-space gradient as the solid shell (see gradientColorAt), so the network and the anatomy it traces read as one coherent material. */
  colors: Float32Array;
  /** Indices of the highest-degree nodes (most edges touching them) — real mesh topology, not arbitrary picks. Rendered as larger "landmark" markers distinct from the uniform point cloud, matching the reference's brighter hub nodes. */
  hubs: number[];
}

/**
 * A sparse node/edge network sharing the exact same shaping (ellipsoid,
 * fissure, lobe bulges, ridged folds) as the solid cerebrum in
 * buildBrainParts, just at much lower subdivision — the "connectome"
 * presentation: a constellation of glowing points along the real cortical
 * surface, connected by the mesh's own triangle edges, rather than a solid
 * shaded shell. detail=2 keeps node/edge counts small enough for legible,
 * uncluttered glowing points+lines instead of a dense mesh smear.
 */
export function buildNeuralWeb(detail = 2): NeuralWeb {
  const raw = new THREE.IcosahedronGeometry(1, detail);
  const welded = weldGeometry(raw);
  raw.dispose();
  displaceCortex(welded, CEREBRUM_SCALE, cerebrumShapeFactor, 2.6, 0.03);

  const position = welded.getAttribute("position") as THREE.BufferAttribute;
  const positions = new Float32Array(position.array);

  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    c.copy(gradientColorAt(position.getY(i)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const index = welded.getIndex()!;
  const seen = new Set<string>();
  const edgePairs: number[] = [];
  const degree = new Array<number>(position.count).fill(0);
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edgePairs.push(a, b);
      degree[a]++;
      degree[b]++;
    }
  }
  welded.dispose();

  // The reference's brighter "landmark" nodes read as a handful of real
  // high-connectivity junctions, not a random sprinkle — the mesh's own
  // vertex degree is exactly that, already computed above from real
  // topology.
  const hubs = degree
    .map((d, i) => [d, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 7)
    .map(([, i]) => i);

  return { positions, edges: new Uint32Array(edgePairs), colors, hubs };
}

// Same world-space Y placement each part gets in BrainMesh.tsx's useParts()
// — kept here too (single source of truth would require threading React
// state through a pure geometry module) so the baked gradient lines up with
// where each part actually renders, rather than each part restarting its
// own local gradient from y=0.
const PART_Y_OFFSET = { right: 0, left: 0, cerebellum: -0.64, brainstem: -0.56, corpusCallosum: 0.08 } as const;

export function buildBrainParts(): BrainParts {
  // NOTE ON `detail`: three.js PolyhedronGeometry subdivides each icosahedron
  // edge into (detail + 1) segments — it is a LINEAR count, not a recursion
  // level. `detail: 6` therefore yields 20 * 7^2 = 980 triangles, roughly 500
  // vertices, which is why the cortex rendered as a faceted low-poly shell and
  // swallowed every fold displacement no matter how deep: a sulcus simply had
  // no vertices to be carved into. 48 gives 20 * 49^2 ~= 48k triangles, which
  // is the resolution gyri need and still a single modest draw call.
  const cerebrumRaw = new THREE.IcosahedronGeometry(1, CEREBRUM_DETAIL);
  const cerebrumBase = weldGeometry(cerebrumRaw);
  cerebrumRaw.dispose();
  displaceCortex(cerebrumBase, CEREBRUM_SCALE, cerebrumShapeFactor, 5.4, 0.05);
  const { positiveX: right, negativeX: left } = splitByX(cerebrumBase);
  cerebrumBase.dispose();

  const cerebellumRaw = new THREE.IcosahedronGeometry(1, CEREBELLUM_DETAIL);
  const cerebellumGeo = weldGeometry(cerebellumRaw);
  cerebellumRaw.dispose();
  displaceCortex(cerebellumGeo, CEREBELLUM_SCALE, () => 0, 12.0, 0.035);

  const brainstem = new THREE.CylinderGeometry(0.15, 0.21, 0.5, 14, 3);
  brainstem.computeVertexNormals();

  const corpusCallosum = new THREE.TorusGeometry(0.27, 0.045, 8, 28, Math.PI);
  corpusCallosum.computeVertexNormals();

  applyGradientVertexColors(right, PART_Y_OFFSET.right);
  applyGradientVertexColors(left, PART_Y_OFFSET.left);
  applyGradientVertexColors(cerebellumGeo, PART_Y_OFFSET.cerebellum);
  applyGradientVertexColors(brainstem, PART_Y_OFFSET.brainstem);
  applyGradientVertexColors(corpusCallosum, PART_Y_OFFSET.corpusCallosum);

  return { right, left, cerebellum: cerebellumGeo, brainstem, corpusCallosum };
}
