"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Mesh } from "three";
import type { BrainState } from "@/lib/brain/graph";
import { useThemeColors } from "@/components/brain/three/useThemeColors";
import { CORE_RADIUS } from "@/components/brain/three/layout3d";

const STATE_COLOR_VAR: Record<BrainState, string> = {
  idle: "--muted-foreground",
  thinking: "--core-thinking",
  researching: "--core-executing",
  executing: "--core-executing",
  waiting: "--warning",
  learning: "--core-listening",
  error: "--core-error",
};

// Real backend state -> how urgently the core should breathe. idle is
// nearly still; error/waiting (both need a human) pulse fastest. This is
// the only place the Brain's overall "how alive does it feel" signal is
// decided, and it reads directly from getBrainState() — never a decorative
// cycle running on its own clock.
const STATE_PULSE_SPEED: Record<BrainState, number> = {
  idle: 0.35,
  thinking: 1.1,
  researching: 1.3,
  executing: 1.6,
  waiting: 1.8,
  learning: 1.1,
  error: 2.1,
};

export function CoreOrb({ state, reducedMotion }: { state: BrainState; reducedMotion: boolean }) {
  const meshRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const colors = useThemeColors();
  const color = useMemo(() => new THREE.Color(colors[STATE_COLOR_VAR[state] as keyof typeof colors]), [colors, state]);

  useFrame(({ clock }) => {
    if (!meshRef.current || !glowRef.current) return;
    const speed = reducedMotion ? 0.15 : STATE_PULSE_SPEED[state];
    const amplitude = reducedMotion ? 0.015 : state === "idle" ? 0.02 : 0.05;
    const pulse = 1 + Math.sin(clock.elapsedTime * speed) * amplitude;
    meshRef.current.scale.setScalar(pulse);
    glowRef.current.scale.setScalar(pulse * 1.45);
    const material = meshRef.current.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = reducedMotion ? 0.9 : 0.75 + Math.sin(clock.elapsedTime * speed) * 0.25;
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[CORE_RADIUS, 2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.75} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh ref={glowRef}>
        <icosahedronGeometry args={[CORE_RADIUS, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} toneMapped={false} side={THREE.BackSide} />
      </mesh>
      <pointLight color={color} intensity={2.2} distance={9} decay={2} />
    </group>
  );
}
