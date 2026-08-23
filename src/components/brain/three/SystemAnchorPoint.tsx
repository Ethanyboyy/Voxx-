"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import type { BrainSystem } from "@/components/brain/three/systems";
import { SYSTEM_COLOR, SYSTEM_LABEL } from "@/components/brain/three/systems";
import type { SystemAnchor } from "@/components/brain/three/layout3d";

const DAMP = 0.1;

export function SystemAnchorPoint({
  anchor,
  active,
  pulseUntil,
  onFocus,
}: {
  anchor: SystemAnchor;
  /** true when this system is the currently-focused/expanded one (or Dissect is on) */
  active: boolean;
  /** performance.now() timestamp until which this anchor should visibly pulse from a real live event, or null */
  pulseUntil: number | null;
  onFocus: (system: BrainSystem) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const posRef = useRef(new THREE.Vector3(...anchor.position));
  const color = SYSTEM_COLOR[anchor.system];
  const baseSize = 0.32 + Math.min(0.5, Math.log2(anchor.count + 1) * 0.14);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const alpha = Math.min(1, DAMP * delta * 60);
    posRef.current.lerp(new THREE.Vector3(...anchor.position), alpha);
    meshRef.current.position.copy(posRef.current);

    const pulsing = pulseUntil != null && performance.now() < pulseUntil;
    const scale = pulsing ? baseSize * (1.15 + Math.sin(performance.now() * 0.012) * 0.1) : hovered ? baseSize * 1.08 : baseSize;
    meshRef.current.scale.setScalar(scale);

    const material = meshRef.current.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = pulsing ? 1.4 : active ? 0.9 : 0.5;
  });

  return (
    <mesh
      ref={meshRef}
      position={anchor.position}
      onClick={(e) => {
        e.stopPropagation();
        onFocus(anchor.system);
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
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.3} metalness={0.35} transparent opacity={active ? 1 : 0.75} />
      <Html distanceFactor={11} center style={{ pointerEvents: "none" }}>
        <div className="lab-mono flex flex-col items-center whitespace-nowrap text-center">
          <span className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {SYSTEM_LABEL[anchor.system]}
          </span>
          <span className="mt-1 text-[9px] text-white/50">{anchor.count} {anchor.count === 1 ? "item" : "items"}</span>
        </div>
      </Html>
    </mesh>
  );
}
