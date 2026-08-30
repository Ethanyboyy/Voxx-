"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SURFACE_SPECS, type ArmorSlot, type SuitBuild } from "@/components/lab/three/suitConfig";
import { CANONICAL_BODY_HEIGHT } from "@/components/lab/three/canonicalBody";
import { createChamferedSlab, createLensGeometry, createShellPanel } from "@/components/lab/three/panelGeometry";
import { canBuildFabric, getFabricMaps } from "@/components/lab/three/fabricTexture";
import type { MaskLensStyle } from "@/components/lab/three/suitDesign";

/**
 * The suit's hard components, as real geometry mounted on the body.
 *
 * The previous version built every piece from RoundedBox, and rendering it
 * showed exactly what that costs: a box knows nothing about the limb it is
 * covering, so the forearm and shoulder pieces read as detached slabs
 * floating beside the arm, the torso stayed bare, and the helmet was a
 * smooth ovoid that looked like a bare skull. Colour and lighting cannot
 * repair a silhouette.
 *
 * So the hard components are now CURVED SHELLS (see panelGeometry.ts) that
 * wrap the limb they sit on, with wall thickness and a machined edge, and
 * the helmet is a mask built around two real lenses.
 *
 * Every piece is still mounted to a REAL joint read from the body asset's
 * own skeleton at runtime, never to a hardcoded coordinate — that is what
 * lets one set of mounts fit any rigged body in any pose.
 */

/** Body-relative sizes, so the armour rescales with the canonical body
 *  rather than being a set of magic numbers tuned to one asset. */
const H = CANONICAL_BODY_HEIGHT;

interface ShellMount {
  bone: string;
  /** Second joint; the piece sits between the two and aligns to the limb. */
  toBone?: string;
  /** Fraction along bone→toBone at which the piece is centred. */
  along?: number;
  /** Radius of the limb underneath, as a fraction of body height. */
  radius: number;
  /** Wall thickness, as a fraction of body height. */
  thickness: number;
  /** How far around the limb the shell wraps. */
  arc: number;
  /** Length along the limb, as a fraction of body height. */
  length: number;
  /** Radius multiplier at the far end — limbs taper, armour should too. */
  taper?: number;
  /** Rotates the wrap; 0 keeps the shell on the FRONT of the limb. */
  facing?: number;
  /** Offset from the mount point, in body-local axes. */
  offset?: [number, number, number];
  /**
   * Joints that define the shell's AXIS, when that differs from the joints
   * that define its position.
   *
   * A shell's open ends are perpendicular to its axis. Run a chest plate's
   * axis up the spine and its open ends become the top and bottom rims,
   * pointing at the camera — which rendered as a bright scoop cut into the
   * figure's chest. A real breastplate runs its axis SHOULDER TO SHOULDER, so
   * it curves from waist to collar and its open ends are tucked at the sides
   * under the arms where nothing sees them.
   */
  axisFrom?: string;
  axisTo?: string;
}

/**
 * Limb and torso shells.
 *
 * Radii are deliberately a touch larger than the limb inside them: armour
 * that intersects the body reads as painted on, armour that stands off it by
 * a visible millimetre reads as worn. The previous pass had these NARROWER
 * than the limb, which is why the guards looked like they were hovering
 * beside the arm rather than clamped around it.
 */
const SHELLS: Partial<Record<ArmorSlot, ShellMount>> = {
  // ARC is the value that decides whether a piece reads as armour or as
  // plumbing. Past about 2.4rad a shell closes far enough to become a tube,
  // and an open-ended tube shows its hollow interior at the ends — the first
  // render of this rebuild put open pipes on every limb for exactly that
  // reason. Plates stay under ~135°, and only the belt and collar, which
  // genuinely encircle the body, go beyond it.
  forearmL: { bone: "LeftForeArm", toBone: "LeftHand", along: 0.5, radius: 0.0235, thickness: 0.005, arc: 2.2, length: 0.062, taper: 0.9 },
  forearmR: { bone: "RightForeArm", toBone: "RightHand", along: 0.5, radius: 0.0235, thickness: 0.005, arc: 2.2, length: 0.062, taper: 0.9 },
  thighL: { bone: "LeftUpLeg", toBone: "LeftLeg", along: 0.48, radius: 0.044, thickness: 0.0062, arc: 2.0, length: 0.105, taper: 0.82 },
  thighR: { bone: "RightUpLeg", toBone: "RightLeg", along: 0.48, radius: 0.044, thickness: 0.0062, arc: 2.0, length: 0.105, taper: 0.82 },
  shinL: { bone: "LeftLeg", toBone: "LeftFoot", along: 0.45, radius: 0.029, thickness: 0.0045, arc: 2.2, length: 0.105, taper: 0.78 },
  shinR: { bone: "RightLeg", toBone: "RightFoot", along: 0.45, radius: 0.029, thickness: 0.0045, arc: 2.2, length: 0.105, taper: 0.78 },
  gloveL: { bone: "LeftHand", toBone: "LeftHandMiddle1", along: 0.5, radius: 0.022, thickness: 0.0045, arc: 2.6, length: 0.032, taper: 0.92 },
  gloveR: { bone: "RightHand", toBone: "RightHandMiddle1", along: 0.5, radius: 0.022, thickness: 0.0045, arc: 2.6, length: 0.032, taper: 0.92 },
  bootL: { bone: "LeftFoot", toBone: "LeftToeBase", along: 0.4, radius: 0.03, thickness: 0.0055, arc: 2.8, length: 0.045, taper: 0.96 },
  bootR: { bone: "RightFoot", toBone: "RightToeBase", along: 0.4, radius: 0.03, thickness: 0.0055, arc: 2.8, length: 0.045, taper: 0.96 },
  // Torso shells wrap the chest/back rather than sitting proud of it as a
  // slab, so the figure stops reading as a bare mannequin with a badge on it.
  // The radius is the distance from the SPINE to the chest surface, not half
  // the chest's width — setting it to the latter produced a barrel the figure
  // stood inside.
  // A torso shell wraps a VERTICAL axis, so its length is the piece's height
  // and its open ends are its top and bottom rims. Make it tall and the rim
  // sits at eye level and the whole thing reads as a canister strapped to the
  // chest. A cuirass is the opposite proportion: short, wrapping far around
  // the ribs, with the top rim tucked under the collar where it is not seen.
  // Axis runs shoulder to shoulder: `length` is therefore the plate's WIDTH
  // across the chest, and `arc` is how far it curves from waist up to collar.
  chest: { bone: "Spine1", toBone: "Neck", along: 0.45, radius: 0.052, thickness: 0.0068, arc: 1.5, length: 0.15, axisFrom: "LeftArm", axisTo: "RightArm" },
  backpack: { bone: "Spine1", toBone: "Neck", along: 0.42, radius: 0.052, thickness: 0.0068, arc: 1.2, length: 0.135, facing: Math.PI, axisFrom: "LeftArm", axisTo: "RightArm" },
  belt: { bone: "Hips", toBone: "Spine", along: 0.28, radius: 0.052, thickness: 0.0062, arc: 5.2, length: 0.018, taper: 1 },
  collar: { bone: "Neck", toBone: "Head", along: 0.08, radius: 0.036, thickness: 0.0045, arc: 3.4, length: 0.02, taper: 1.04 },
};

/** Caps: pieces that sit ON a surface rather than wrapping it. */
interface CapMount {
  bone: string;
  offset: [number, number, number];
  size: [number, number, number];
  /** Rolls the cap so a pauldron follows the shoulder rather than facing front. */
  rotation?: [number, number, number];
}

const CAPS: Partial<Record<ArmorSlot, CapMount>> = {
  shoulderL: { bone: "LeftArm", offset: [-0.012, 0.014, 0], size: [0.058, 0.05, 0.062], rotation: [0, 0, 0.35] },
  shoulderR: { bone: "RightArm", offset: [0.012, 0.014, 0], size: [0.058, 0.05, 0.062], rotation: [0, 0, -0.35] },
  kneeL: { bone: "LeftLeg", offset: [0, 0.004, 0.036], size: [0.042, 0.046, 0.016] },
  kneeR: { bone: "RightLeg", offset: [0, 0.004, 0.036], size: [0.042, 0.046, 0.016] },
};

/** Slots drawn in the suit's TRIM colour rather than its plate colour — the
 *  third pigment that stops the figure reading as one swatch. */
const TRIM_SLOTS = new Set<ArmorSlot>(["gloveL", "gloveR", "bootL", "bootR", "collar", "belt"]);

/**
 * Mask lens proportions. These are genuinely different faces, not a renamed
 * same one: a wide recon lens and a narrow tactical slit change the whole
 * read of the head, which is the first thing anyone looks at.
 */
const LENS_SPEC: Record<MaskLensStyle, { width: number; height: number; squareness: number; tilt: number; spread: number; rise: number }> = {
  NARROW: { width: 0.024, height: 0.011, squareness: 0.15, tilt: 0.4, spread: 0.023, rise: 0.008 },
  WIDE: { width: 0.031, height: 0.018, squareness: 0.1, tilt: 0.28, spread: 0.026, rise: 0.006 },
  ANGULAR: { width: 0.028, height: 0.014, squareness: 0.35, tilt: 0.46, spread: 0.025, rise: 0.007 },
  ROUND: { width: 0.022, height: 0.02, squareness: 0.0, tilt: 0.16, spread: 0.022, rise: 0.005 },
  MECHANICAL: { width: 0.026, height: 0.013, squareness: 0.8, tilt: 0.2, spread: 0.024, rise: 0.006 },
};

/** Slots that follow the shoulders outward as the build widens. */
const SPREADS_WITH_SHOULDERS = new Set<ArmorSlot>(["shoulderL", "shoulderR", "forearmL", "forearmR"]);

export interface SuitArmorProps {
  build: SuitBuild;
  /** Material per surface class, built once by the caller and shared across
   *  every piece — see buildSurfaceMaterials. */
  materials: Record<string, THREE.Material>;
  /** Accent used by the powered chest core and telemetry strips. */
  accent: string;
  /** Hides hard components so the underlying body can be inspected. */
  hidden?: boolean;
  /** Pushes each piece along its mount normal, for the exploded view. */
  explodeAmount?: number;
  /** Real joint positions read from the body asset's own skeleton. */
  anchors: Map<string, THREE.Vector3>;
  /** Lens shape for the helmet visor. */
  maskLensStyle?: MaskLensStyle;
  /**
   * Selection wiring. Ids are the SAME ids the Laboratory's component bridge
   * uses (see lib/lab/slotBridge.ts), so a clicked mesh resolves to a real
   * LabComponent rather than to a generic "the suit was clicked" event.
   */
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
}

/**
 * Builds the rotation that puts a piece's local +Z down the limb AND its
 * local +Y toward the body's front.
 *
 * setFromUnitVectors alone leaves roll unconstrained, which does not matter
 * for a box but matters enormously for a shell: an unconstrained roll puts
 * the open side of a shin guard facing sideways or backwards at random. A
 * full basis pins it.
 */
function limbBasis(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const dir = to.clone().sub(from).normalize();
  const front = new THREE.Vector3(0, 0, 1);
  // Degenerate when the limb itself points front/back; fall back to world up.
  const ref = Math.abs(dir.dot(front)) > 0.9 ? new THREE.Vector3(0, 1, 0) : front;
  const x = ref.clone().cross(dir).normalize();
  const y = dir.clone().cross(x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, dir));
}

export function SuitArmor({ build, materials, accent, anchors, maskLensStyle = "ANGULAR", hidden = false, explodeAmount = 0, selectedId = null, hoveredId = null, onSelect, onHover }: SuitArmorProps)  {
  // One emissive material for every telemetry element on the suit. Built
  // here rather than per-piece so 12 components don't allocate 12 identical
  // materials — and disposed with the memo when the build changes.
  const coreMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        // Scaled by the build's own emissive strength: a Stealth suit's
        // instrumentation is genuinely near-dark, not merely a darker purple.
        emissiveIntensity: 0.85 * build.emissiveStrength,
        metalness: 0.3,
        roughness: 0.35,
        toneMapped: false,
      }),
    [accent, build.emissiveStrength]
  );

  const selectionMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    [accent]
  );

  const hoverMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#cfd4e4",
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    []
  );

  const lensMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.5 * build.emissiveStrength,
        metalness: 0.9,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        toneMapped: false,
      }),
    [accent, build.emissiveStrength]
  );

  /**
   * Every shell and cap geometry for this build, created once and disposed
   * together. Three.js never frees GPU buffers on its own, and this component
   * rebuilds whenever the suit or its bulk changes.
   */
  const geometries = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const piece of build.pieces) {
      const shell = SHELLS[piece.slot];
      if (shell) {
        map.set(
          piece.slot,
          createShellPanel({
            radius: shell.radius * H,
            // Bulk thickens armour rather than growing it in every direction,
            // so a heavy build reads as heavier plate, not a larger person.
            thickness: shell.thickness * H * piece.bulk,
            arc: shell.arc,
            length: shell.length * H,
            taper: shell.taper,
            facing: shell.facing,
            bevel: 0.0035 * H,
          })
        );
        continue;
      }
      const cap = CAPS[piece.slot];
      if (cap) {
        map.set(
          piece.slot,
          createChamferedSlab(cap.size[0] * H, cap.size[1] * H, cap.size[2] * H * piece.bulk, 0.005 * H)
        );
      }
    }
    return map;
  }, [build.pieces]);

  const lensGeometry = useMemo(() => {
    const spec = LENS_SPEC[maskLensStyle];
    return createLensGeometry({
      width: spec.width * H,
      height: spec.height * H,
      depth: 0.012 * H,
      squareness: spec.squareness,
    });
  }, [maskLensStyle]);

  useEffect(() => {
    return () => {
      for (const g of geometries.values()) g.dispose();
    };
  }, [geometries]);

  useEffect(() => () => lensGeometry.dispose(), [lensGeometry]);
  useEffect(() => () => coreMaterial.dispose(), [coreMaterial]);
  useEffect(() => () => lensMaterial.dispose(), [lensMaterial]);
  useEffect(() => () => selectionMaterial.dispose(), [selectionMaterial]);
  useEffect(() => () => hoverMaterial.dispose(), [hoverMaterial]);

  if (hidden) return null;

  const head = anchors.get("Head");

  /**
   * Highlight for a selected or hovered part.
   *
   * Drawn as an overlay on the SAME geometry rather than by swapping the
   * piece's material: swapping loses the material identity that tells the user
   * what the part is made of, which is most of the point of selecting it.
   * depthWrite stays off so the overlay never occludes the part it marks.
   */
  const highlightFor = (id: string) => {
    if (selectedId === id) return selectionMaterial;
    if (hoveredId === id) return hoverMaterial;
    return null;
  };
  const lens = LENS_SPEC[maskLensStyle];

  return (
    <group>
      {build.pieces.map((piece) => {
        const geometry = geometries.get(piece.slot);
        if (!geometry) return null;

        const shell = SHELLS[piece.slot];
        const cap = CAPS[piece.slot];
        const mountBone = shell?.bone ?? cap?.bone;
        if (!mountBone) return null;

        const from = anchors.get(mountBone);
        // A joint this asset does not have simply carries no armour, rather
        // than dropping a plate at the origin. A body with no left arm should
        // not sprout a forearm guard at its feet.
        if (!from) return null;

        const toBone = shell?.toBone;
        const to = toBone ? anchors.get(toBone) : undefined;

        const material = TRIM_SLOTS.has(piece.slot)
          ? (materials.TRIM ?? materials[piece.surface] ?? materials.FABRIC)
          : (materials[piece.surface] ?? materials.FABRIC);

        const base = to ? from.clone().lerp(to, shell?.along ?? 0.5) : from.clone();
        const [ox, oy, oz] = shell?.offset ?? cap?.offset ?? [0, 0, 0];
        base.add(new THREE.Vector3(ox * H, oy * H, oz * H));

        const spread = SPREADS_WITH_SHOULDERS.has(piece.slot) ? build.shoulderSpread : 1;
        base.x *= spread;

        // Explode pushes each piece away from the body's vertical axis.
        const outward = new THREE.Vector3(base.x, 0, base.z);
        if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
        outward.normalize().multiplyScalar(0.3 * explodeAmount);
        base.add(outward);

        // Orientation can come from a different joint pair than position —
        // see ShellMount.axisFrom.
        const axisFrom = shell?.axisFrom ? anchors.get(shell.axisFrom) : from;
        const axisTo = shell?.axisTo ? anchors.get(shell.axisTo) : to;
        const quaternion = shell && axisFrom && axisTo ? limbBasis(axisFrom, axisTo) : new THREE.Quaternion();

        return (
          <group key={piece.slot} position={base.toArray()} quaternion={quaternion}>
            <mesh
              geometry={geometry}
              material={material}
              rotation={cap?.rotation ?? [0, 0, 0]}
              castShadow
              receiveShadow
              onPointerDown={(e) => {
                // stopPropagation matters: without it a click passes through to
                // every piece behind the one actually under the cursor, and the
                // last one wins — selecting the far side of the body.
                e.stopPropagation();
                onSelect?.(piece.slot);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onHover?.(piece.slot);
              }}
              onPointerOut={() => onHover?.(null)}
            />
            {highlightFor(piece.slot) ? (
              <mesh
                geometry={geometry}
                material={highlightFor(piece.slot)!}
                rotation={cap?.rotation ?? [0, 0, 0]}
                scale={1.035}
                raycast={() => null}
              />
            ) : null}

            {/* A thin lit strip on the leading edge of the torso plates. The
                suit's instrumentation is a small physical element that is
                switched on, not a wash over the whole panel — a wash reads
                as an effect, an edge reads as a component. */}
            {/* Local axes here follow the shell's basis, so for the chest
                plate X is up, Y is out from the body, and Z runs across the
                chest — the strip spans Z. */}
            {piece.slot === "chest" ? (
              <mesh position={[0.026 * H, (shell?.radius ?? 0.062) * H + 0.005 * H, 0]} material={coreMaterial}>
                <boxGeometry args={[0.004 * H, 0.003 * H, 0.062 * H]} />
              </mesh>
            ) : null}
          </group>
        );
      })}

      {/* Helmet.
          Built as a mask, not a head. The previous version put one sphere
          over the whole face and the render read as a bare alien skull with
          two dark sockets — because what makes a mask legible is its LENSES:
          two large, hard-edged, angled shapes that dominate the front. So the
          lenses are real bevelled solids set into a recessed brow, and the
          cranium behind them is plain. */}
      {head ? (
        <group position={head.clone().add(new THREE.Vector3(0, 0.016 * H, 0.002 * H)).toArray()}>
          {/* Cranium — ovoid, wider than tall, sitting over the skull. */}
          <mesh
            material={materials[build.plate] ?? materials.ARMOR}
            castShadow
            scale={[1.0, 1.1, 1.06]}
            onPointerDown={(e) => { e.stopPropagation(); onSelect?.("mask"); }}
            onPointerOver={(e) => { e.stopPropagation(); onHover?.("mask"); }}
            onPointerOut={() => onHover?.(null)}
          >
            <sphereGeometry args={[0.054 * H, 32, 24]} />
          </mesh>

          {/* Brow band in trim, running across the top of the lenses. It is
              the shadow line under this that sets the lenses INTO the face
              rather than leaving them stuck on the surface. */}
          <mesh position={[0, 0.03 * H, 0.03 * H]} rotation={[0.32, 0, 0]} material={materials.TRIM ?? materials.ARMOR} castShadow>
            <boxGeometry args={[0.052 * H, 0.008 * H, 0.02 * H]} />
          </mesh>

          {/* Jaw / breather guard, in trim so the lower face has its own
              value and the head does not read as one moulded lump. */}
          <mesh position={[0, -0.028 * H, 0.032 * H]} material={materials.TRIM ?? materials.ELASTOMER} castShadow>
            <boxGeometry args={[0.032 * H, 0.018 * H, 0.018 * H]} />
          </mesh>

          {/* The lenses. Mirrored, angled inward-and-down, which is what
              gives a mask an expression instead of a stare. They sit just
              proud of the cranium surface at this Z — pushed further out
              they detach from the head and read as goggles hanging in front
              of it, which is exactly what the first attempt produced. */}
          {([-1, 1] as const).map((side) => (
            <mesh
              key={side}
              geometry={lensGeometry}
              material={lensMaterial}
              position={[side * lens.spread * H, lens.rise * H, 0.046 * H]}
              rotation={[0.12, side * 0.3, side * -lens.tilt]}
              scale={[side, 1, 1]}
              onPointerDown={(e) => { e.stopPropagation(); onSelect?.(side === 1 ? "lensL" : "lensR"); }}
              onPointerOver={(e) => { e.stopPropagation(); onHover?.(side === 1 ? "lensL" : "lensR"); }}
              onPointerOut={() => onHover?.(null)}
            />
          ))}
        </group>
      ) : null}

      {/* Powered chest core — only on builds whose archetype actually
          specifies one, so it means "this suit carries a power system"
          rather than being decoration every suit wears. */}
      {build.chestCore && anchors.get("Spine2") ? (
        <group position={anchors.get("Spine2")!.clone().add(new THREE.Vector3(0, 0.006 * H, 0.058 * H)).toArray()}>
          <mesh material={coreMaterial}>
            <cylinderGeometry args={[0.011 * H, 0.011 * H, 0.006 * H, 24]} />
          </mesh>
          {/* Housing ring in plate material — the core is mounted INTO
              something, not floating on the chest. */}
          <mesh rotation={[Math.PI / 2, 0, 0]} material={materials[build.plate] ?? materials.ARMOR}>
            <torusGeometry args={[0.016 * H, 0.0035 * H, 12, 28]} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/**
 * Builds one material per surface class the suit actually uses.
 *
 * MeshPhysicalMaterial rather than MeshStandardMaterial specifically for
 * clearcoat and sheen: those two are what separate a rigid shell from a
 * woven panel under the same key light. Without them every surface lands in
 * the same narrow band of plastic-looking response no matter what roughness
 * says, which is precisely how the suit ended up reading as one flat object.
 */
/**
 * Lifts a suit's stored colour to something that survives being lit.
 *
 * Suit records store colorSecondary as a near-black identity value (#0a0616
 * and similar). Used raw as a base colour that is physically correct and
 * visually useless: the body renders as a void, no roughness or clearcoat
 * difference is visible on it, and the whole figure reads as a silhouette
 * with a glowing chest. Real dark garments are not RGB-zero either — they
 * scatter enough to show their weave.
 *
 * So the stored hue is kept and only its VALUE is floored. A stealth suit
 * still reads far darker than an experimental one; it just stops being a
 * hole in the frame.
 */
function paletteColor(hex: string, l: number, sat: number, hueShift = 0): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Hue wraps; a shift past 1 must come back round rather than clamp, or a
  // suit near the top of the wheel loses its shift entirely.
  const h = (hsl.h + hueShift + 1) % 1;
  // Lightness and saturation are SET from the palette, not floored from the
  // stored colour. Flooring gave every layer a near-identical value and the
  // whole figure read as one moulded object; the palette is what makes the
  // shell, the body and the trim three distinguishable pigments.
  return new THREE.Color().setHSL(h, sat, l);
}

export function buildSurfaceMaterials(
  build: SuitBuild,
  colorPrimary: string,
  colorSecondary: string,
  options: { xray?: boolean; neutral?: boolean } = {}
): Record<string, THREE.Material> {
  const classes = new Set<string>([build.underlayer, build.plate, "ELASTOMER", "ARMOR", "FABRIC"]);
  const out: Record<string, THREE.Material> = {};
  const p = build.palette;

  for (const cls of classes) {
    const spec = SURFACE_SPECS[cls as keyof typeof SURFACE_SPECS];
    if (!spec) continue;

    if (options.neutral) {
      // QA clay: geometry only. Roughness still varies by class so the FORM
      // of each component stays readable with all colour identity removed.
      out[cls] = new THREE.MeshPhysicalMaterial({ color: "#8b8794", metalness: 0.02, roughness: spec.roughness });
      continue;
    }

    const isUnderlayer = cls === build.underlayer;
    const base = isUnderlayer
      ? paletteColor(colorSecondary, p.underlayerL, p.underlayerS)
      : paletteColor(colorSecondary, p.plateL, p.plateS, p.plateHueShift);

    // The UNDERLAYER is the suit itself, and it is what the whole design reads
    // as. Give it a real woven surface: the body asset carries UVs, so a
    // tiled weave normal + roughness pair makes it respond like textile
    // instead of returning the single clean highlight that made it read as
    // bare skin. Plates deliberately do NOT get this — a hard shell with a
    // weave on it reads as painted cloth.
    const wovenMaps =
      isUnderlayer && !options.xray && canBuildFabric()
        ? getFabricMaps(cls === "ELASTOMER" ? "RIBBED_ELASTOMER" : "TECHNICAL_WEAVE", cls === "ELASTOMER" ? 16 : 24)
        : null;

    out[cls] = new THREE.MeshPhysicalMaterial({
      color: base,
      metalness: spec.metalness,
      roughness: spec.roughness,
      clearcoat: spec.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness,
      sheen: spec.sheen,
      ...(wovenMaps
        ? {
            normalMap: wovenMaps.normalMap,
            // Kept low. A weave is a fine surface, and a normal scale that
            // reads correctly in a close-up turns the whole figure crepey at
            // full-body framing, which is the shot that actually matters here.
            normalScale: new THREE.Vector2(1.2, 1.2),
            roughnessMap: wovenMaps.roughnessMap,
          }
        : {}),
      // Neutral, NOT the accent. Sheen is how woven material catches light
      // at a grazing angle; tinting it with the suit's accent turned it into
      // a hue injection that washed the entire body purple and defeated the
      // palette regardless of what the base colour resolved to.
      sheenColor: new THREE.Color("#e8e6ea"),
      sheenRoughness: 0.55,
      transparent: options.xray === true,
      opacity: options.xray ? 0.2 : 1,
    });
  }

  // The third pigment. Gloves, boots, collar, belt, brow and seams wear this
  // rather than the plate colour, which is what stops a suit reading as one
  // swatch at three brightnesses.
  out.TRIM = options.neutral
    ? new THREE.MeshPhysicalMaterial({ color: "#77737f", metalness: 0.02, roughness: 0.6 })
    : new THREE.MeshPhysicalMaterial({
        color: paletteColor(colorPrimary, p.trimL, p.trimS, p.trimHueShift),
        metalness: 0.25,
        roughness: 0.42,
        clearcoat: 0.5,
        clearcoatRoughness: 0.35,
        transparent: options.xray === true,
        opacity: options.xray ? 0.2 : 1,
      });

  return out;
}
