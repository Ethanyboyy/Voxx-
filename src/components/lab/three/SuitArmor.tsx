"use client";

import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { SURFACE_SPECS, type ArmorSlot, type SuitBuild } from "@/components/lab/three/suitConfig";
import type { MaskLensStyle } from "@/components/lab/three/suitDesign";

/**
 * The suit's hard components, as real geometry mounted on the body.
 *
 * This module exists because the previous suit was a bare human mesh with a
 * tinted material on it — which is exactly what it looked like. A garment
 * reads as constructed when light catches an actual edge: a plate that
 * stands off the chest and casts a shadow onto it, a pauldron that breaks
 * the shoulder silhouette, a forearm guard with a visible gap under it.
 * None of that can be painted on, so none of it is.
 *
 * Every piece is mounted to a REAL joint read from the body asset's own
 * skeleton at runtime, not to a hardcoded coordinate. That is what lets one
 * set of mounts fit any rigged body and any pose: the first version guessed
 * an arms-down pose, the asset turned out to be in a T-pose, and the forearm
 * guards rendered floating in mid-air beside the hips.
 */

/**
 * Each armour slot names the skeleton joint it is mounted to, plus how it
 * sits relative to that joint. Positions come from the ASSET's own bones at
 * runtime (see GltfSuitModel's anchors map), never from hardcoded
 * coordinates — the first version of this guessed an arms-down pose, the
 * body turned out to be in a T-pose, and the forearm guards rendered
 * floating in mid-air beside the hips.
 */
interface Mount {
  /** Mixamo joint name, minus the "mixamorig:" prefix. */
  bone: string;
  /** Second joint; when present the piece sits BETWEEN the two, which is how
   *  a limb guard should behave regardless of how the limb is posed. */
  toBone?: string;
  /** Fraction along bone→toBone at which the piece sits. */
  along?: number;
  /** Offset from the joint, in body-local axes. */
  offset?: [number, number, number];
  /** Half-extents before the build's bulk multiplier. */
  size: [number, number, number];
  radius: number;
  /** Bulk thickens armour rather than growing it in every direction. */
  bulkAxis?: "depth" | "all";
  /** Aligns the piece's long axis to the bone→toBone direction. */
  alignToBone?: boolean;
}

const MOUNTS: Record<ArmorSlot, Mount> = {
  collar: { bone: "Neck", offset: [0, -0.03, 0], size: [0.1, 0.03, 0.075], radius: 0.02, bulkAxis: "depth" },
  chest: { bone: "Spine2", offset: [0, 0.02, 0.075], size: [0.115, 0.11, 0.025], radius: 0.026, bulkAxis: "depth" },
  backpack: { bone: "Spine1", offset: [0, 0.06, -0.095], size: [0.095, 0.125, 0.035], radius: 0.028, bulkAxis: "depth" },
  shoulderL: { bone: "LeftArm", offset: [0, 0.03, 0], size: [0.058, 0.05, 0.058], radius: 0.028, bulkAxis: "all" },
  shoulderR: { bone: "RightArm", offset: [0, 0.03, 0], size: [0.058, 0.05, 0.058], radius: 0.028, bulkAxis: "all" },
  // Between elbow and wrist, aligned to the forearm — correct in any pose.
  forearmL: { bone: "LeftForeArm", toBone: "LeftHand", along: 0.55, size: [0.035, 0.035, 0.07], radius: 0.015, bulkAxis: "depth", alignToBone: true },
  forearmR: { bone: "RightForeArm", toBone: "RightHand", along: 0.55, size: [0.035, 0.035, 0.07], radius: 0.015, bulkAxis: "depth", alignToBone: true },
  belt: { bone: "Hips", offset: [0, 0.02, 0.012], size: [0.1, 0.026, 0.07], radius: 0.013, bulkAxis: "depth" },
  thighL: { bone: "LeftUpLeg", toBone: "LeftLeg", along: 0.5, size: [0.048, 0.048, 0.08], radius: 0.02, bulkAxis: "depth", alignToBone: true },
  thighR: { bone: "RightUpLeg", toBone: "RightLeg", along: 0.5, size: [0.048, 0.048, 0.08], radius: 0.02, bulkAxis: "depth", alignToBone: true },
  shinL: { bone: "LeftLeg", toBone: "LeftFoot", along: 0.45, size: [0.04, 0.04, 0.085], radius: 0.016, bulkAxis: "depth", alignToBone: true },
  shinR: { bone: "RightLeg", toBone: "RightFoot", along: 0.45, size: [0.04, 0.04, 0.085], radius: 0.016, bulkAxis: "depth", alignToBone: true },
};

/** Visor proportions per mask style — a wide recon lens and a narrow
 *  tactical slit are genuinely different faces, not a renamed same one. */
const LENS_SCALE: Record<MaskLensStyle, [number, number, number]> = {
  NARROW: [1.05, 0.45, 0.5],
  WIDE: [1.35, 0.72, 0.5],
  ANGULAR: [1.2, 0.6, 0.5],
  ROUND: [1.0, 0.95, 0.5],
  MECHANICAL: [1.15, 0.5, 0.62],
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
}

export function SuitArmor({ build, materials, accent, anchors, maskLensStyle = "ANGULAR", hidden = false, explodeAmount = 0 }: SuitArmorProps) {
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

  if (hidden) return null;

  return (
    <group>
      {build.pieces.map((piece) => {
        const mount = MOUNTS[piece.slot];
        const from = anchors.get(mount.bone);
        // A joint this asset does not have simply carries no armour, rather
        // than dropping a plate at the origin. A body with no left arm should
        // not sprout a forearm guard at its feet.
        if (!from) return null;
        const to = mount.toBone ? anchors.get(mount.toBone) : undefined;
        const material = materials[piece.surface] ?? materials.FABRIC;

        const [sx, sy, sz] = mount.size;
        const size: [number, number, number] =
          mount.bulkAxis === "all"
            ? [sx * piece.bulk, sy * piece.bulk, sz * piece.bulk]
            : [sx, sy, sz * piece.bulk];

        // Limb guards sit BETWEEN two joints and align to the limb, so they
        // stay on the limb whatever pose the asset is authored in.
        const base = to ? from.clone().lerp(to, mount.along ?? 0.5) : from.clone();
        const [ox, oy, oz] = mount.offset ?? [0, 0, 0];
        base.add(new THREE.Vector3(ox, oy, oz));

        const spread = SPREADS_WITH_SHOULDERS.has(piece.slot) ? build.shoulderSpread : 1;
        base.x *= spread;

        // Explode pushes each piece away from the body's vertical axis.
        const outward = new THREE.Vector3(base.x, 0, base.z);
        if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
        outward.normalize().multiplyScalar(0.3 * explodeAmount);
        base.add(outward);

        // Orient the piece's long (Z) axis down the limb.
        const quaternion = new THREE.Quaternion();
        if (mount.alignToBone && to) {
          const dir = to.clone().sub(from).normalize();
          quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        }

        return (
          <group key={piece.slot} position={base.toArray()} quaternion={quaternion}>
            <RoundedBox args={[size[0] * 2, size[1] * 2, size[2] * 2]} radius={mount.radius} smoothness={4} material={material} castShadow receiveShadow />

            {/* A thin lit strip on the leading edge of the torso plates. The
                suit's instrumentation is a small physical element that is
                switched on, not a wash over the whole panel — a wash reads
                as an effect, an edge reads as a component. */}
            {(piece.slot === "chest" || piece.slot === "backpack" || piece.slot === "belt") ? (
              <mesh position={[0, size[1] * 0.6, size[2] * 1.02]} material={coreMaterial}>
                <boxGeometry args={[size[0] * 1.2, 0.007, 0.004]} />
              </mesh>
            ) : null}
          </group>
        );
      })}


      {/* Helmet and visor. A suit without a head covering is a person in
          leggings — this is the single element that makes the figure read as
          wearing equipment rather than being an undressed mannequin. The
          shell is plate material so it shares the suit's construction, and
          the lens is the only genuinely reflective surface on the body,
          which is what draws the eye to the head where it belongs. */}
      {anchors.get("Head") ? (
        <group position={anchors.get("Head")!.clone().add(new THREE.Vector3(0, 0.055, 0)).toArray()}>
          <mesh material={materials[build.plate] ?? materials.ARMOR} castShadow>
            <sphereGeometry args={[0.105, 32, 24]} />
          </mesh>
          {/* Visor — a lens set INTO the shell, sized by the suit's own mask
              style so recon and combat suits do not wear the same face. */}
          <mesh position={[0, 0.012, 0.062]} scale={LENS_SCALE[maskLensStyle]}>
            <sphereGeometry args={[0.062, 24, 18]} />
            <meshPhysicalMaterial
              color={accent}
              emissive={new THREE.Color(accent)}
              emissiveIntensity={0.5 * build.emissiveStrength}
              metalness={0.9}
              roughness={0.08}
              clearcoat={1}
              clearcoatRoughness={0.05}
              toneMapped={false}
            />
          </mesh>
        </group>
      ) : null}

      {/* Powered chest core — only on builds whose archetype actually
          specifies one, so it means "this suit carries a power system"
          rather than being decoration every suit wears. */}
      {build.chestCore && anchors.get("Spine2") ? (
        <group position={anchors.get("Spine2")!.clone().add(new THREE.Vector3(0, 0.02, 0.105)).toArray()}>
          <mesh material={coreMaterial}>
            <cylinderGeometry args={[0.024, 0.024, 0.012, 24]} />
          </mesh>
          {/* Housing ring in plate material — the core is mounted INTO
              something, not floating on the chest. */}
          <mesh rotation={[Math.PI / 2, 0, 0]} material={materials[build.plate] ?? materials.ARMOR}>
            <torusGeometry args={[0.034, 0.008, 12, 28]} />
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
function liftForRender(hex: string, targetL: number, targetS: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // The stored hue is the suit's identity and is kept. Lightness is SET, not
  // floored: flooring produced a 5% spread between the underlayer and its
  // plates, which is invisible, and the whole figure read as one moulded
  // plastic object. Layers have to differ by a value a viewer can actually
  // see before roughness and clearcoat have anything to differentiate.
  return new THREE.Color().setHSL(hsl.h, targetS, targetL);
}

/**
 * Value and saturation per surface class.
 *
 * Plates are markedly lighter AND less saturated than the underlayer they
 * are mounted on: real hard components are pigmented differently from woven
 * material, and desaturating them is what stops a suit reading as one colour
 * applied to a whole mannequin. The spread here is deliberately large — it
 * is the single biggest lever on whether the render looks constructed.
 */
const SURFACE_VALUE: Record<string, { l: number; s: number }> = {
  FABRIC: { l: 0.085, s: 0.4 },
  TECHNICAL_FABRIC: { l: 0.11, s: 0.32 },
  ELASTOMER: { l: 0.07, s: 0.3 },
  ARMOR: { l: 0.3, s: 0.16 },
  METAL: { l: 0.46, s: 0.08 },
};

export function buildSurfaceMaterials(
  build: SuitBuild,
  colorPrimary: string,
  colorSecondary: string,
  options: { xray?: boolean; neutral?: boolean } = {}
): Record<string, THREE.Material> {
  const classes = new Set<string>([build.underlayer, build.plate, "ELASTOMER", "ARMOR", "FABRIC"]);
  const out: Record<string, THREE.Material> = {};

  for (const cls of classes) {
    const spec = SURFACE_SPECS[cls as keyof typeof SURFACE_SPECS];
    if (!spec) continue;

    if (options.neutral) {
      // QA clay: geometry only. Roughness still varies by class so the
      // FORM of each component stays readable without any colour identity.
      out[cls] = new THREE.MeshPhysicalMaterial({ color: "#8b8794", metalness: 0.02, roughness: spec.roughness });
      continue;
    }

    // Plates sit above the underlayer's value so panel boundaries read as a
    // material change, not only as a geometry seam. The floor is what makes
    // the suit visible at all; the tint is what separates its layers.
    const value = SURFACE_VALUE[cls] ?? SURFACE_VALUE.FABRIC;
    // A class serving as this suit's underlayer sits at its own darker
    // value; the same class used as a plate elsewhere reads lighter.
    const isUnderlayer = cls === build.underlayer;
    const base = liftForRender(colorSecondary, isUnderlayer ? value.l * 0.8 : value.l, value.s);
    out[cls] = new THREE.MeshPhysicalMaterial({
      color: base,
      metalness: spec.metalness,
      roughness: spec.roughness,
      clearcoat: spec.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness,
      sheen: spec.sheen,
      sheenColor: new THREE.Color(colorPrimary),
      sheenRoughness: 0.6,
      transparent: options.xray === true,
      opacity: options.xray ? 0.2 : 1,
    });
  }

  return out;
}
