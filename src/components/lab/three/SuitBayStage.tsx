"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { approach } from "@/lib/3d/animation";
import { QUALITY_BUDGETS, type QualityTier } from "@/lib/3d/quality";
import { CANONICAL_FEET_Y } from "@/components/lab/three/canonicalBody";
import type { LightingPreset } from "@/lib/experience/world";

/**
 * The Suit Bay as a physical room.
 *
 * This is the piece that decides whether VOX reads as an environment or as a
 * web page with a 3D widget in it, so the choices here are deliberate:
 *
 * - **A real floor.** A dark, faintly reflective surface with depth-faded
 *   blur. A suit standing on nothing has no scale and no weight; a suit
 *   standing on a floor that catches a smear of its own colour does. This is
 *   the single highest-value element in the scene and it is why the floor gets
 *   a reflector rather than a flat plane.
 * - **Platforms, not pedestals.** Low, wide, machined-looking discs with a thin
 *   recessed light line. Restrained: the platform is furniture, not decoration.
 * - **Light falls off.** Each bay has its own overhead pool of light and the
 *   room goes black between them. Even illumination is what makes CG rooms look
 *   like software; falloff is what makes them look like places.
 * - **Negative space.** Bays are spaced wider than they need to be. The brief
 *   asks for room to breathe and that costs nothing but restraint.
 *
 * Everything scales down honestly by tier — on MOBILE the reflector drops to a
 * plain matte floor rather than rendering a second pass of the whole scene.
 */

export interface BaySlot {
  id: string;
  /** World position of the platform centre. */
  position: [number, number, number];
  /** Radians the suit faces. */
  rotation: number;
  label: string;
  accent: string;
}

/** Bay spacing, metres. Wider than needed — the suits must breathe. */
const BAY_SPACING = 1.78;
const PLATFORM_RADIUS = 0.62;
export const PLATFORM_HEIGHT = 0.085;

/**
 * How far to lift a normalised body so its feet land on the platform.
 *
 * Every suit asset is normalised to stand with its feet at CANONICAL_FEET_Y
 * (-1.3), which is correct for the single-suit viewer where the camera and the
 * projection platform are built around that origin. Dropped into a room whose
 * floor is y=0, the same asset stands with its legs below the floor and renders
 * as a torso sitting on the platform — which is exactly what the first capture
 * of this room showed.
 */
export const BODY_LIFT = -CANONICAL_FEET_Y + PLATFORM_HEIGHT;

/**
 * Lays bays out along a shallow arc facing the camera.
 *
 * An arc rather than a line so that every suit is angled slightly toward the
 * viewer and the far ones do not present as edge-on slivers — the same reason
 * a real showroom curves its display line.
 */
export function layoutBays(
  ids: Array<{ id: string; label: string; accent: string }>,
  // 12m, not 7.5m: at the tighter radius a five-bay room turned its end
  // suits 27 degrees away from the viewer, which reads as suits facing off
  // into the room rather than as a display line.
  radius = 12,
): BaySlot[] {
  const count = ids.length;
  if (count === 0) return [];
  // Arc length is driven by spacing, so two suits sit close and eight spread
  // out, instead of a fixed arc that bunches or strands them.
  const step = count > 1 ? BAY_SPACING / radius : 0;
  const start = -((count - 1) / 2) * step;
  return ids.map((entry, i) => {
    const angle = start + i * step;
    return {
      id: entry.id,
      label: entry.label,
      accent: entry.accent,
      // z = radius*(cos-1): zero at the centre bay, curving gently away at the
      // ends. The previous form simplified to a constant -radius, which put the
      // whole line 7.5m behind the camera's framing.
      position: [Math.sin(angle) * radius, 0, radius * (Math.cos(angle) - 1)] as [number, number, number],
      rotation: -angle,
    };
  });
}

/** A single display platform with its recessed accent line. */
function Platform({
  slot,
  active,
  dimmed,
  reducedMotion,
  onSelect,
}: {
  slot: BaySlot;
  active: boolean;
  dimmed: boolean;
  reducedMotion: boolean;
  onSelect?: (id: string) => void;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const target = active ? 1 : dimmed ? 0.12 : 0.4;
  const current = useRef(target);

  useFrame((_, delta) => {
    const mesh = ring.current;
    if (!mesh) return;
    const k = reducedMotion ? 1 : approach(3.5, delta);
    current.current += (target - current.current) * k;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.06 + current.current * 0.4;
  });

  return (
    <group position={slot.position} rotation={[0, slot.rotation, 0]}>
      {/* The platform body. Machined metal, not a glowing puck: it reads as
          something that was manufactured and installed. */}
      <mesh
        position={[0, PLATFORM_HEIGHT / 2, 0]}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect?.(slot.id);
        }}
      >
        <cylinderGeometry args={[PLATFORM_RADIUS, PLATFORM_RADIUS * 1.04, PLATFORM_HEIGHT, 64]} />
        <meshStandardMaterial color="#17171b" roughness={0.42} metalness={0.75} envMapIntensity={0.6} />
      </mesh>

      {/* Recessed light line around the rim. A thin ring, never a halo. */}
      <mesh ref={ring} position={[0, PLATFORM_HEIGHT + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PLATFORM_RADIUS * 0.9, PLATFORM_RADIUS * 0.945, 64]} />
        <meshBasicMaterial color={active ? slot.accent : "#6f7482"} transparent opacity={0.14} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Overhead pool of light, per bay. The falloff between bays is what
          makes the room feel like a room. */}
      <spotLight
        position={[0, 3.4, 0.35]}
        target-position={[0, 0, 0]}
        angle={0.46}
        penumbra={0.82}
        intensity={active ? 34 : dimmed ? 7 : 18}
        distance={9}
        decay={2}
        color="#f2f0ff"
        castShadow={false}
      />
    </group>
  );
}

/**
 * The room's architecture.
 *
 * The first captures of this bay showed suits floating in a black void with an
 * enormous empty frame above and below them: the floor existed, but nothing
 * else did, so there was no midground, no background and no ceiling to give the
 * space a size. Black is only negative space when there is something for it to
 * be negative to.
 *
 * Everything here is deliberately architectural rather than decorative — a back
 * wall with recessed vertical light channels, a structural ceiling grid, and
 * side returns. It is cheap (a handful of boxes and emissive strips), it never
 * competes with the suits because it is unlit dark surface with thin light
 * lines, and it gives the camera something to travel past.
 */
function Architecture({ lighting, tier }: { lighting: LightingPreset; tier: QualityTier }) {
  const dark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#0b0b0f", roughness: 0.85, metalness: 0.3 }),
    [],
  );
  const strip = useMemo(
    () => new THREE.MeshBasicMaterial({ color: lighting.accent, transparent: true, opacity: 0.16, toneMapped: false }),
    [lighting.accent],
  );
  const cool = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#8ea0c8", transparent: true, opacity: 0.1, toneMapped: false }),
    [],
  );

  // Bay pilasters: vertical structure behind the platform line. The light
  // channel between them is what reads as "engineered room" rather than "wall".
  const pilasters = useMemo(() => {
    const count = tier === "MOBILE" ? 7 : 11;
    return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * 2.6);
  }, [tier]);

  return (
    <group>
      {/* Back wall, set well behind the bays so fog can do its work. */}
      <mesh position={[0, 3.4, -9.5]} material={dark} receiveShadow>
        <boxGeometry args={[46, 7.6, 0.4]} />
      </mesh>

      {pilasters.map((x) => (
        <group key={x} position={[x, 0, -9.1]}>
          <mesh position={[0, 2.4, 0]} material={dark}>
            <boxGeometry args={[0.72, 4.8, 0.34]} />
          </mesh>
          {/* Recessed vertical light channel. Thin, dim, and never a glow. */}
          <mesh position={[0, 2.4, 0.19]} material={strip}>
            <planeGeometry args={[0.075, 4.1]} />
          </mesh>
        </group>
      ))}

      {/* Side returns: they close the room off laterally so the space reads as
          a hall rather than an infinite plane. */}
      {[-14.5, 14.5].map((x) => (
        <mesh key={x} position={[x, 3.4, -2]} rotation={[0, Math.PI / 2, 0]} material={dark}>
          <boxGeometry args={[16, 7.6, 0.4]} />
        </mesh>
      ))}

      {/* Structural ceiling. Its job is to stop the top half of the frame being
          empty, and to give the overhead bay lights something to belong to. */}
      <mesh position={[0, 7.1, -2]} material={dark}>
        <boxGeometry args={[46, 0.5, 24]} />
      </mesh>
      {tier !== "MOBILE"
        ? [-6, -2, 2, 6].map((z) => (
            <mesh key={z} position={[0, 6.82, z]} rotation={[Math.PI / 2, 0, 0]} material={cool}>
              <planeGeometry args={[26, 0.09]} />
            </mesh>
          ))
        : null}
    </group>
  );
}

/**
 * Cinematic lighting on whatever the camera has moved in on.
 *
 * The room's own bay lights are overhead pools aimed at the floor, which is
 * correct for a wide shot and useless for a subject: by the time that light
 * reaches a torso it has fallen off by the square of about 2.4m, and the first
 * capture of the authored suit was a barely-readable silhouette because of it.
 *
 * A subject gets its own three-light rig, keyed to chest height rather than the
 * floor, and it only exists while something IS the subject — so the wide shot
 * keeps its falloff and its darkness.
 */
function SubjectLighting({
  position,
  active,
  accent,
  reducedMotion,
}: {
  position: [number, number, number];
  active: boolean;
  accent: string;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const level = useRef(0);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    const k = reducedMotion ? 1 : approach(2.4, delta);
    level.current += ((active ? 1 : 0) - level.current) * k;
    node.traverse((child) => {
      const light = child as THREE.Light & { userData: { baseIntensity?: number } };
      if (!light.isLight) return;
      const base = light.userData.baseIntensity;
      if (base !== undefined) light.intensity = base * level.current;
    });
  });

  const chest = 1.34;

  return (
    <group ref={group} position={position}>
      {/* Key: high and off-axis, aimed at the chest. This is what actually
          models the garment — its falloff across the ribcage and thighs is
          where fabric reads as fabric. */}
      <spotLight
        position={[1.35, 2.5, 2.0]}
        target-position={[0, chest, 0]}
        angle={0.62}
        penumbra={0.75}
        distance={7}
        decay={2}
        color="#fff6ea"
        userData={{ baseIntensity: 78 }}
        intensity={0}
      />
      {/* Fill: opposite side, cool and much weaker, so the shadow side keeps
          some detail without flattening the key. */}
      <spotLight
        position={[-1.7, 1.5, 1.5]}
        target-position={[0, chest, 0]}
        angle={0.7}
        penumbra={0.9}
        distance={6}
        decay={2}
        color="#b9c6ee"
        userData={{ baseIntensity: 20 }}
        intensity={0}
      />
      {/* Rim: behind and above, in the suit's own accent. This is the light
          that separates a dark garment from a dark room. */}
      <spotLight
        position={[-0.5, 2.3, -2.1]}
        target-position={[0, chest * 1.15, 0]}
        angle={0.6}
        penumbra={0.6}
        distance={6}
        decay={2}
        color={accent}
        userData={{ baseIntensity: 44 }}
        intensity={0}
      />
    </group>
  );
}

export interface SuitBayStageProps {
  slots: BaySlot[];
  selectedId: string | null;
  /** True while one suit is being inspected — the rest of the room recedes. */
  focused: boolean;
  lighting: LightingPreset;
  tier: QualityTier;
  reducedMotion?: boolean;
  onSelect?: (id: string) => void;
  /** The hero suit content, positioned by the caller onto its platform. */
  children?: React.ReactNode;
}

/**
 * The room: floor, platforms, lighting. Suits mount as `children` so this file
 * stays the environment and never learns what a suit is.
 */
export function SuitBayStage({
  slots,
  selectedId,
  focused,
  lighting,
  tier,
  reducedMotion = false,
  onSelect,
  children,
}: SuitBayStageProps) {
  const budget = QUALITY_BUDGETS[tier];
  // A reflector renders the scene a second time. That is affordable on a
  // desktop GPU and is not on a phone, so MOBILE gets an honest matte floor
  // rather than a reflection at a resolution too low to read as one.
  const reflective = tier !== "MOBILE";
  const resolution = tier === "HERO" ? 1024 : 512;

  const fogColor = useMemo(() => new THREE.Color("#050507"), []);
  const selectedSlot = slots.find((slot) => slot.id === selectedId) ?? null;

  return (
    <group>
      <color attach="background" args={["#050507"]} />
      <fog attach="fog" args={[fogColor, focused ? 4.5 : 6, focused ? 17 : 30]} />

      {/* Ambient is kept very low on purpose: the room should be lit BY the
          bay lights, not by a global wash that flattens every surface. */}
      <ambientLight intensity={lighting.ambient * 1.9} color="#c9c4de" />
      {/* One soft key from high and off-axis, so the floor and platforms have
          a consistent light direction to model against. */}
      <directionalLight
        position={[4.5, 7, 5]}
        intensity={lighting.key * 0.85}
        color="#fbfaff"
        castShadow={budget.shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1}
        shadow-camera-far={24}
      />
      {/* Cool bounce from behind, to separate silhouettes from the black. */}
      <directionalLight position={[-5, 2.5, -6]} intensity={lighting.rim * 1.3} color={lighting.accent} />

      {/* The floor. Large enough that its edge is never in frame. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        {reflective ? (
          <MeshReflectorMaterial
            resolution={resolution}
            mixBlur={1.1}
            mixStrength={2.4}
            blur={[320, 90]}
            // Depth-faded so the reflection dies off with distance instead of
            // mirroring the whole room — a perfect mirror reads as a bug.
            depthScale={1.15}
            minDepthThreshold={0.35}
            maxDepthThreshold={1.35}
            mirror={0.35}
            color="#0a0a0d"
            metalness={0.62}
            roughness={0.88}
          />
        ) : (
          <meshStandardMaterial color="#0a0a0d" roughness={0.92} metalness={0.35} />
        )}
      </mesh>

      <Architecture lighting={lighting} tier={tier} />

      {slots.map((slot) => (
        <Platform
          key={slot.id}
          slot={slot}
          active={slot.id === selectedId}
          dimmed={focused && slot.id !== selectedId}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
        />
      ))}

      {selectedSlot ? (
        <SubjectLighting
          position={selectedSlot.position}
          active={focused}
          accent={selectedSlot.accent}
          reducedMotion={reducedMotion}
        />
      ) : null}

      {children}
    </group>
  );
}
