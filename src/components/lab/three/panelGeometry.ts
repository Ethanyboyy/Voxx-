import * as THREE from "three";

/**
 * Geometry primitives for suit hard components.
 *
 * The suit's armour was built from RoundedBox, and at render it showed:
 * a box has no idea what shape the thing under it is, so every limb guard
 * read as a detached slab hovering beside the arm rather than a shell
 * clamped around it. No amount of colour, lighting or material work fixes
 * that, because the failure is in the silhouette.
 *
 * A real limb guard is a CURVED SHELL — a section of a tube, with wall
 * thickness and a machined edge. That is what these builders produce.
 * Everything is a plain BufferGeometry so the caller owns disposal.
 */

export interface ShellPanelOptions {
  /** Inner radius — the shell sits ON a limb of roughly this radius. */
  radius: number;
  /** Wall thickness of the plate. */
  thickness: number;
  /** How far around the limb the shell wraps, in radians. */
  arc: number;
  /** Length along the limb (the local Z axis). */
  length: number;
  /**
   * Radius multiplier at the far (+Z) end. Limbs taper — a thigh guard with
   * parallel sides reads as a pipe, and the calf/knee transition disappears.
   */
  taper?: number;
  /** Edge break. Small and non-zero is what makes an edge catch the key light. */
  bevel?: number;
  /** Rotates the wrap so the shell can face front, outboard, or back. */
  facing?: number;
}

/**
 * A curved armour shell: an annular sector extruded along Z, bevelled.
 *
 * Extruding an arc rather than lathing gives real, closed side walls, so the
 * plate has a visible EDGE with thickness where it meets the body. That edge
 * catching light is most of what separates armour from a painted-on decal.
 */
export function createShellPanel(options: ShellPanelOptions): THREE.BufferGeometry {
  const { radius, thickness, arc, length, taper = 1, bevel = 0.004, facing = 0 } = options;

  const outer = radius + thickness;
  const half = arc / 2;
  // Centre the wrap on +Y, then rotate by `facing`, so a shell defaults to
  // sitting on top of / in front of the limb rather than at an arbitrary angle.
  const start = Math.PI / 2 - half + facing;
  const end = Math.PI / 2 + half + facing;

  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, start, end, false);
  shape.absarc(0, 0, radius, end, start, true);
  shape.closePath();

  // Bevel must stay well under the wall thickness or the bevel geometry
  // self-intersects and the panel renders as a crumpled shell.
  const bevelSize = Math.min(bevel, thickness * 0.35, length * 0.2);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    curveSegments: 24,
    bevelEnabled: bevelSize > 0.0001,
    bevelThickness: bevelSize,
    bevelSize,
    bevelOffset: 0,
    bevelSegments: 2,
  });

  // Extrude runs 0..length in +Z; recentre so the caller can position by the
  // panel's middle, which is how the bone-midpoint mounts already work.
  geometry.translate(0, 0, -length / 2);

  if (taper !== 1) {
    applyTaper(geometry, length, taper);
  }

  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Scales each vertex's XY by how far along Z it sits, turning a parallel-sided
 * tube section into a tapered one. Done as a vertex pass because
 * ExtrudeGeometry has no taper option and a scaled mesh would also squash the
 * wall thickness and the bevel.
 */
function applyTaper(geometry: THREE.BufferGeometry, length: number, taper: number): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const z = pos.getZ(i);
    // t: 0 at the near end, 1 at the far end.
    const t = THREE.MathUtils.clamp(z / length + 0.5, 0, 1);
    const k = THREE.MathUtils.lerp(1, taper, t);
    pos.setX(i, pos.getX(i) * k);
    pos.setY(i, pos.getY(i) * k);
  }
  pos.needsUpdate = true;
}

export interface LensOptions {
  /** Half-width of the lens. */
  width: number;
  /** Half-height of the lens. */
  height: number;
  /** Depth of the lens body. */
  depth: number;
  /** 0 = almond/teardrop (classic mask), 1 = rounded rectangle (visor). */
  squareness?: number;
}

/**
 * One mask lens.
 *
 * The helmet previously put a single sphere over the whole face, which read
 * as a bare skull with two dark sockets rather than a mask. A mask reads as a
 * mask because of its LENSES: two large, hard-edged, angled shapes that
 * dominate the face. This builds one, as a real extruded solid with a bevel,
 * so it has a rim that catches light instead of being a painted ellipse.
 */
export function createLensGeometry(options: LensOptions): THREE.BufferGeometry {
  const { width, height, depth, squareness = 0 } = options;
  const shape = new THREE.Shape();

  // Teardrop: wide, blunt inner corner tapering to a point outboard — the
  // shape that makes the face read as a mask rather than as eye holes.
  // `squareness` blends toward a rounded rectangle for visor-style masks.
  const s = THREE.MathUtils.clamp(squareness, 0, 1);
  const tipX = width;
  const innerX = -width;
  const bulge = THREE.MathUtils.lerp(0.55, 0.95, s);
  const tipY = THREE.MathUtils.lerp(0.08, 0.62, s);

  shape.moveTo(innerX, -height * THREE.MathUtils.lerp(0.55, 0.95, s));
  shape.quadraticCurveTo(innerX * 0.2, -height * bulge, tipX * 0.75, -height * tipY);
  shape.quadraticCurveTo(tipX, -height * tipY * 0.5, tipX, height * tipY * 0.35);
  shape.quadraticCurveTo(tipX * 0.8, height * bulge, 0, height * bulge);
  shape.quadraticCurveTo(innerX * 0.7, height * bulge, innerX, height * THREE.MathUtils.lerp(0.5, 0.9, s));
  shape.closePath();

  const bevel = Math.min(depth * 0.35, width * 0.12);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 20,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 3,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flat-ish armour slab with broken edges, for pieces that sit ON a surface
 * rather than wrapping it (pauldron caps, knee caps, chest hardpoints).
 * Distinct from RoundedBox in that the bevel is a hard chamfer, not a fillet:
 * a chamfer produces a specular line along the edge, a fillet smears it.
 */
export function createChamferedSlab(width: number, height: number, depth: number, chamfer = 0.006): THREE.BufferGeometry {
  const w = width / 2;
  const h = height / 2;
  const c = Math.min(chamfer, w * 0.4, h * 0.4);

  const shape = new THREE.Shape();
  shape.moveTo(-w + c, -h);
  shape.lineTo(w - c, -h);
  shape.lineTo(w, -h + c);
  shape.lineTo(w, h - c);
  shape.lineTo(w - c, h);
  shape.lineTo(-w + c, h);
  shape.lineTo(-w, h - c);
  shape.lineTo(-w, -h + c);
  shape.closePath();

  const bevel = Math.min(chamfer, depth * 0.3);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 2,
    bevelEnabled: bevel > 0.0001,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}
