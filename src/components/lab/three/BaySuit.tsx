"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { approach } from "@/lib/3d/animation";
import { portraitPullback, verticalBiasOffset } from "@/lib/3d/framing";
import { CANONICAL_BODY_HEIGHT } from "@/components/lab/three/canonicalBody";

/**
 * Suits that are NOT the current subject.
 *
 * A room with one suit in it and five empty platforms is not a suit bay. But
 * rendering six full assets — each a GLB clone, a pose bake and an armour rig —
 * is not something a phone can do, and would buy detail nobody can resolve at
 * seven metres in near-darkness.
 *
 * So the others are garment FORMS: a suit hanging on its stand, read as a dark
 * silhouette picked out by the rim light. This is a legitimate level of detail,
 * not a placeholder pretending to be a suit — at this distance and this
 * lighting a real asset would resolve to almost exactly this. The moment one
 * becomes the subject, the full asset takes over on its platform.
 */

const H = CANONICAL_BODY_HEIGHT;

export function BaySuitForm({
  accent,
  dimmed,
  onSelect,
  id,
}: {
  accent: string;
  dimmed: boolean;
  id: string;
  onSelect?: (id: string) => void;
}) {
  // One shared dark material: these are silhouettes, and giving each its own
  // material would cost draw calls for a difference nobody can see.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2a2b33",
        roughness: 0.7,
        metalness: 0.22,
        envMapIntensity: 0.75,
      }),
    [],
  );
  const rim = useMemo(
    () => new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.09, side: THREE.BackSide, toneMapped: false, depthWrite: false }),
    [accent],
  );

  const group = useRef<THREE.Group>(null);
  const target = dimmed ? 0.35 : 1;
  const current = useRef(target);

  // Reached through the scene graph rather than through the memoised material
  // above. Mutating a value another render may still be holding is the kind of
  // shared-reference bug that only shows up once a second instance mounts.
  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    current.current += (target - current.current) * approach(3, delta);
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if (!m || Array.isArray(m) || m.type === "MeshBasicMaterial") return;
      m.transparent = current.current < 0.99;
      m.opacity = current.current;
    });
  });

  // Proportions from the same canonical body every real asset is normalised
  // to, so a form and a loaded suit are the same size on their platforms.
  const parts: Array<{ pos: [number, number, number]; args: [number, number, number]; rot?: [number, number, number] }> = [
    { pos: [0, H * 0.9, 0], args: [0.085, 0.105, 0.1] },      // head
    { pos: [0, H * 0.82, 0], args: [0.05, 0.05, 0.06] },      // neck
    { pos: [0, H * 0.66, 0], args: [0.155, 0.19, 0.34] },     // chest
    { pos: [0, H * 0.5, 0], args: [0.13, 0.13, 0.22] },       // waist
    { pos: [-0.19, H * 0.68, 0], args: [0.052, 0.052, 0.3], rot: [0, 0, 0.09] },
    { pos: [0.19, H * 0.68, 0], args: [0.052, 0.052, 0.3], rot: [0, 0, -0.09] },
    { pos: [-0.205, H * 0.47, 0], args: [0.044, 0.044, 0.26], rot: [0, 0, 0.05] },
    { pos: [0.205, H * 0.47, 0], args: [0.044, 0.044, 0.26], rot: [0, 0, -0.05] },
    { pos: [-0.082, H * 0.3, 0], args: [0.068, 0.068, 0.36] },
    { pos: [0.082, H * 0.3, 0], args: [0.068, 0.068, 0.36] },
    { pos: [-0.082, H * 0.09, 0], args: [0.05, 0.05, 0.3] },
    { pos: [0.082, H * 0.09, 0], args: [0.05, 0.05, 0.3] },
  ];

  return (
    <group
      ref={group}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect?.(id);
      }}
    >
      {parts.map((part, i) => (
        <mesh key={i} position={part.pos} rotation={part.rot ?? [0, 0, 0]} material={material} castShadow>
          <capsuleGeometry args={[part.args[0], part.args[2], 4, 12]} />
        </mesh>
      ))}
      {/* A single thin back-side shell for edge separation from the black
          background. Any more than this and the form starts to glow. */}
      <mesh position={[0, H * 0.66, 0]} material={rim} scale={1.05}>
        <capsuleGeometry args={[0.155, 0.34, 4, 12]} />
      </mesh>
    </group>
  );
}

export interface StageCameraProps {
  controls: React.RefObject<OrbitControlsImpl | null>;
  /** Where the subject stands. */
  subject: [number, number, number] | null;
  /** Establishing shot, used when nothing is selected. */
  home: { position: [number, number, number]; target: [number, number, number] };
  /**
   * True world x of the bay the shot should hold, unscaled.
   *
   * The landscape establishing shot deliberately offsets camera and target
   * by DIFFERENT fractions of this to get a three-quarter view of the room.
   * Portrait cannot do that — it has no horizontal room to spare — so it
   * needs the real value to look straight down the bay instead of at a
   * point beside it, which is what cropped the hero off the left edge.
   */
  anchorX?: number;
  /** How close to stand to the subject, in metres. */
  distance: number;
  /** Height on the subject the camera looks at, in metres above the floor. */
  aim: number;
  reducedMotion?: boolean;
  rate?: number;
}

/**
 * The Suit Bay camera.
 *
 * Two shots and the move between them: an establishing wide of the room, and a
 * subject shot standing off the selected platform. It uses the same
 * aspect-aware framing as every other surface, so a phone gets the whole suit
 * instead of a cropped torso, and the same vertical bias so the subject rides
 * above the bottom HUD rather than behind it.
 */
export function StageCamera({
  controls,
  subject,
  home,
  distance,
  aim,
  anchorX,
  reducedMotion = false,
  rate = 2.6,
}: StageCameraProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.height > 0 ? size.width / size.height : 1;

  const desiredPos = useRef(new THREE.Vector3(...home.position));
  const desiredTarget = useRef(new THREE.Vector3(...home.target));

  useFrame((_, delta) => {
    // Cap the portrait correction.
    //
    // The uncapped 1/aspect is right for GUARANTEEING a subject fits, and wrong
    // as a framing rule for a room: at 390x844 it is 2.16, which pushed the
    // establishing shot to ~18m and left the suits as a thin band in a mostly
    // black screen — exactly what the mobile capture showed. 1.45 keeps the
    // subject inside the frame while letting it stay large enough to read.
    const pullback = Math.min(portraitPullback(aspect), 1.45);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;

    if (subject) {
      const bias = verticalBiasOffset(distance * pullback, fov, aspect < 1 ? 0.1 : 0);
      desiredTarget.current.set(subject[0], aim - bias, subject[2]);
      // Stand off toward the room's open side rather than orbiting to a canned
      // angle: the user's own rotation is preserved, and a suit viewed from
      // slightly off-axis reads as an object in a room, not a product shot.
      const offset = new THREE.Vector3(subject[0] * 0.22, aim * 0.42, 1).normalize();
      desiredPos.current
        .copy(desiredTarget.current)
        .addScaledVector(offset, distance * pullback);
    } else {
      // A phone cannot hold five bays across without making each one tiny, so
      // portrait moves IN and accepts that the outer bays fall out of frame.
      //
      // It must also look STRAIGHT AT the subject bay. The landscape framing
      // offsets the camera and the target by different fractions of the
      // subject's x to get a three-quarter view of the room; keeping that
      // offset while moving in swung the camera off-axis and cropped the hero
      // against the left edge, which is what the mobile capture showed.
      if (aspect < 1) {
        const x = anchorX ?? home.target[0];
        desiredTarget.current.set(x, home.target[1], home.target[2]);
        desiredPos.current.set(x, home.position[1] * 0.9, home.position[2] * 0.78);
      } else {
        desiredPos.current.set(...home.position);
        desiredTarget.current.set(...home.target);
      }
    }

    const k = reducedMotion ? 1 : approach(rate, delta);
    camera.position.lerp(desiredPos.current, k);
    const ctl = controls.current;
    if (ctl) {
      ctl.target.lerp(desiredTarget.current, k);
      ctl.update();
    }
  });

  return null;
}
