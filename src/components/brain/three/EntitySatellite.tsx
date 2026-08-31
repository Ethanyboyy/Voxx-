"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import type { BrainNode } from "@/lib/brain/graph";
import { SYSTEM_COLOR, SYSTEM_OF, type Vec3 } from "@/components/brain/three/anatomy";
import { importanceOf } from "@/components/brain/importance";

const DAMP = 0.15;

/**
 * A small marker for one real entity, clustered near its region's anchor.
 * Deliberately minimal — three shapes, not ten — because the anatomical
 * brain is the hero here; satellites are supplementary data points sitting
 * on/near its surface, not a second competing visualization (see brief
 * point 8: "particles are supplemental, they are NOT the brain").
 */
export function EntitySatellite({
  node,
  targetPosition,
  visualState,
  onSelect,
}: {
  node: BrainNode;
  targetPosition: Vec3;
  visualState: "normal" | "focused" | "dimmed";
  onSelect: (nodeId: string) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const posRef = useRef(new THREE.Vector3(...targetPosition));
  // Scratch vector reused every frame. A satellite runs at 60fps and there can
  // be up to SATELLITE_REVEAL_CAP of them per system, so allocating the lerp
  // target inside useFrame handed the GC a few thousand short-lived Vector3s a
  // second for no reason. Mutated, never read outside the frame it is set in.
  const scratch = useRef(new THREE.Vector3());
  const color = SYSTEM_COLOR[SYSTEM_OF[node.type]];
  const weight = importanceOf(node);
  const size = 0.028 + weight * 0.022;

  const isDirectional = node.type === "AGENT_RUN" || node.type === "SUPERVISOR_RUN";
  const isFaceted = node.type === "OBJECTIVE" || node.type === "OPPORTUNITY";

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const alpha = Math.min(1, DAMP * delta * 60);
    posRef.current.lerp(scratch.current.set(...targetPosition), alpha);
    meshRef.current.position.copy(posRef.current);
  });

  const opacity = visualState === "dimmed" ? 0.15 : visualState === "focused" || hovered ? 1 : 0.8;

  return (
    <mesh
      ref={meshRef}
      position={targetPosition}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
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
      {isDirectional ? <coneGeometry args={[size * 0.8, size * 1.8, 6]} /> : isFaceted ? <icosahedronGeometry args={[size, 0]} /> : <sphereGeometry args={[size, 8, 8]} />}
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
      {hovered || visualState === "focused" ? (
        <Html distanceFactor={7} center style={{ pointerEvents: "none" }}>
          <div className="lab-mono whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">{node.label}</div>
        </Html>
      ) : null}
    </mesh>
  );
}
