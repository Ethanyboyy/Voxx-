"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import { SYSTEM_COLOR, SYSTEM_LABEL, SYSTEM_REGION_LABEL, type BrainSystem, type Vec3 } from "@/components/brain/three/anatomy";

/**
 * A small glow marker sitting directly ON the anatomical surface at a
 * system's anchor point — this is the "data through surface illumination,
 * not floating orbs" requirement: it's a localized decal attached to real
 * anatomy, not a large sphere hovering away from the brain.
 */
export function RegionMarker({
  system,
  anchor,
  count,
  active,
  focused,
  pulseUntil,
  onFocus,
}: {
  system: BrainSystem;
  anchor: Vec3;
  count: number;
  /** Broad visual emphasis (bigger/brighter) — safe to be true for several regions at once (e.g. during Dissect). */
  active: boolean;
  /** This exact region is the one explicitly selected — drives the label, which must never show for more than one region at a time. */
  focused: boolean;
  pulseUntil: number | null;
  onFocus: (system: BrainSystem) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = SYSTEM_COLOR[system];
  const baseSize = 0.045 + Math.min(0.035, Math.log2(count + 1) * 0.012);

  useFrame(() => {
    if (!meshRef.current) return;
    const pulsing = pulseUntil != null && performance.now() < pulseUntil;
    const scale = pulsing ? baseSize * (1.5 + Math.sin(performance.now() * 0.014) * 0.25) : hovered || focused ? baseSize * 1.5 : active ? baseSize * 1.15 : baseSize;
    meshRef.current.scale.setScalar(scale);
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = pulsing ? 1 : hovered || focused ? 1 : active ? 0.85 : 0.6;
  });

  return (
    <group position={anchor}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onFocus(system);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} toneMapped={false} />
      </mesh>
      {/* A thin, tight glow halo — big enough to read as "lit from within,"
          small enough not to look like a separate floating orb hovering in
          front of the surface. */}
      <mesh scale={baseSize * 1.6}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={hovered || focused ? 0.22 : 0.09} toneMapped={false} depthWrite={false} />
      </mesh>
      {hovered || focused ? (
        <Html distanceFactor={7} center style={{ pointerEvents: "none" }}>
          <div className="lab-mono flex flex-col items-center whitespace-nowrap rounded-lg border border-white/10 bg-black/75 px-2.5 py-1.5 text-center backdrop-blur-sm">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white">{SYSTEM_LABEL[system]}</span>
            <span className="text-[9px] text-white/50">{SYSTEM_REGION_LABEL[system]} · {count} {count === 1 ? "item" : "items"}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}
