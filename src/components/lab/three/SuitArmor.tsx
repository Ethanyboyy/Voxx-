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
  // Fitted, not bulky. The first pass that actually rendered was oversized
  // across the board — a chest plate the width of the torso, forearm blocks
  // wider than the arms inside them — and the figure read as a toy in armour
  // rather than a person wearing a technical garment. Armour that fits is
  // narrower than the body part it covers is deep, and stands off it by
  // millimetres, not centimetres.
  collar: { bone: "Neck", offset: [0, -0.018, 0.008], size: [0.062, 0.026, 0.058], radius: 0.014, bulkAxis: "depth" },
  chest: { bone: "Spine2", offset: [0, 0.012, 0.072], size: [0.078, 0.082, 0.018], radius: 0.02, bulkAxis: "depth" },
  backpack: { bone: "Spine1", offset: [0, 0.055, -0.082], size: [0.062, 0.088, 0.022], radius: 0.018, bulkAxis: "depth" },
  shoulderL: { bone: "LeftArm", offset: [-0.008, 0.022, 0], size: [0.044, 0.038, 0.044], radius: 0.02, bulkAxis: "all" },
  shoulderR: { bone: "RightArm", offset: [0.008, 0.022, 0], size: [0.044, 0.038, 0.044], radius: 0.02, bulkAxis: "all" },
  forearmL: { bone: "LeftForeArm", toBone: "LeftHand", along: 0.5, size: [0.03, 0.03, 0.062], radius: 0.012, bulkAxis: "depth", alignToBone: true },
  forearmR: { bone: "RightForeArm", toBone: "RightHand", along: 0.5, size: [0.03, 0.03, 0.062], radius: 0.012, bulkAxis: "depth", alignToBone: true },
  belt: { bone: "Hips", offset: [0, 0.022, 0.012], size: [0.086, 0.02, 0.062], radius: 0.01, bulkAxis: "depth" },
  thighL: { bone: "LeftUpLeg", toBone: "LeftLeg", along: 0.45, size: [0.045, 0.045, 0.07], radius: 0.016, bulkAxis: "depth", alignToBone: true },
  thighR: { bone: "RightUpLeg", toBone: "RightLeg", along: 0.45, size: [0.045, 0.045, 0.07], radius: 0.016, bulkAxis: "depth", alignToBone: true },
  shinL: { bone: "LeftLeg", toBone: "LeftFoot", along: 0.46, size: [0.036, 0.036, 0.072], radius: 0.013, bulkAxis: "depth", alignToBone: true },
  shinR: { bone: "RightLeg", toBone: "RightFoot", along: 0.46, size: [0.036, 0.036, 0.072], radius: 0.013, bulkAxis: "depth", alignToBone: true },
  kneeL: { bone: "LeftLeg", offset: [0, 0, 0.032], size: [0.032, 0.03, 0.018], radius: 0.012, bulkAxis: "all" },
  kneeR: { bone: "RightLeg", offset: [0, 0, 0.032], size: [0.032, 0.03, 0.018], radius: 0.012, bulkAxis: "all" },
  gloveL: { bone: "LeftHand", toBone: "LeftHandMiddle1", along: 0.9, size: [0.032, 0.026, 0.042], radius: 0.012, bulkAxis: "all", alignToBone: true },
  gloveR: { bone: "RightHand", toBone: "RightHandMiddle1", along: 0.9, size: [0.032, 0.026, 0.042], radius: 0.012, bulkAxis: "all", alignToBone: true },
  bootL: { bone: "LeftFoot", toBone: "LeftToeBase", along: 0.5, size: [0.042, 0.042, 0.058], radius: 0.014, bulkAxis: "all", alignToBone: true },
  bootR: { bone: "RightFoot", toBone: "RightToeBase", along: 0.5, size: [0.042, 0.042, 0.058], radius: 0.014, bulkAxis: "all", alignToBone: true },
};

/** Slots drawn in the suit's TRIM colour rather than its plate colour — the
 *  third pigment that stops the figure reading as one swatch. */
const TRIM_SLOTS = new Set<ArmorSlot>(["gloveL", "gloveR", "bootL", "bootR", "collar", "belt"]);

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
        const material = TRIM_SLOTS.has(piece.slot)
          ? (materials.TRIM ?? materials[piece.surface] ?? materials.FABRIC)
          : (materials[piece.surface] ?? materials.FABRIC);

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


      {/* Helmet. Built as separate components rather than one sphere: a
          shell, a brow ridge that casts a shadow into the visor recess, a
          jaw guard, and the lens itself set INTO a housing. A single squashed
          sphere over a face reads as a bike helmet; the recess and the brow
          are what make it read as engineered headgear. */}
      {anchors.get("Head") ? (
        <group position={anchors.get("Head")!.clone().add(new THREE.Vector3(0, 0.028, 0.004)).toArray()}>
          {/* Shell — slightly ovoid, wider than tall, so it reads as a helmet
              over a head rather than a ball. */}
          <mesh material={materials[build.plate] ?? materials.ARMOR} castShadow scale={[1.0, 1.12, 1.08]}>
            <sphereGeometry args={[0.093, 32, 24]} />
          </mesh>

          {/* Brow ridge — the single element that gives the head a readable
              front. Without it the helmet has no orientation from any angle. */}
          <mesh
            position={[0, 0.036, 0.062]}
            rotation={[0.35, 0, 0]}
            material={materials.TRIM ?? materials[build.plate] ?? materials.ARMOR}
            castShadow
          >
            <boxGeometry args={[0.125, 0.02, 0.04]} />
          </mesh>

          {/* Jaw / breather guard. */}
          <mesh position={[0, -0.05, 0.062]} material={materials.TRIM ?? materials.ELASTOMER} castShadow>
            <boxGeometry args={[0.07, 0.038, 0.036]} />
          </mesh>

          {/* Visor housing — the lens sits inside this, not on the surface. */}
          <mesh position={[0, 0.0, 0.05]} scale={LENS_SCALE[maskLensStyle]} material={materials.ELASTOMER ?? materials.FABRIC}>
            <sphereGeometry args={[0.062, 24, 18]} />
          </mesh>

          {/* Lens. The only genuinely reflective surface on the figure, which
              is what draws the eye to the head where it belongs. */}
          <mesh position={[0, 0.0, 0.056]} scale={LENS_SCALE[maskLensStyle]}>
            <sphereGeometry args={[0.057, 24, 18]} />
            <meshPhysicalMaterial
              color={accent}
              emissive={new THREE.Color(accent)}
              emissiveIntensity={0.42 * build.emissiveStrength}
              metalness={0.95}
              roughness={0.06}
              clearcoat={1}
              clearcoatRoughness={0.04}
              toneMapped={false}
            />
          </mesh>
        </group>
      ) : null}

      {/* Torso seam. One construction line down the sternum, in trim, so the
          body has a visible panel boundary instead of being one continuous
          surface. Deliberately singular — scattering lines over the model is
          what makes procedural suits look decorated rather than built. */}
      {anchors.get("Spine") && anchors.get("Neck") ? (
        <mesh
          position={anchors
            .get("Spine")!
            .clone()
            .lerp(anchors.get("Neck")!, 0.5)
            .add(new THREE.Vector3(0, 0, 0.072))
            .toArray()}
          material={materials.TRIM ?? materials.ELASTOMER}
        >
          <boxGeometry args={[0.009, 0.2, 0.007]} />
        </mesh>
      ) : null}

      {/* Powered chest core — only on builds whose archetype actually
          specifies one, so it means "this suit carries a power system"
          rather than being decoration every suit wears. */}
      {build.chestCore && anchors.get("Spine2") ? (
        <group position={anchors.get("Spine2")!.clone().add(new THREE.Vector3(0, 0.012, 0.098)).toArray()}>
          <mesh material={coreMaterial}>
            <cylinderGeometry args={[0.017, 0.017, 0.009, 24]} />
          </mesh>
          {/* Housing ring in plate material — the core is mounted INTO
              something, not floating on the chest. */}
          <mesh rotation={[Math.PI / 2, 0, 0]} material={materials[build.plate] ?? materials.ARMOR}>
            <torusGeometry args={[0.024, 0.005, 12, 28]} />
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

    out[cls] = new THREE.MeshPhysicalMaterial({
      color: base,
      metalness: spec.metalness,
      roughness: spec.roughness,
      clearcoat: spec.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness,
      sheen: spec.sheen,
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
