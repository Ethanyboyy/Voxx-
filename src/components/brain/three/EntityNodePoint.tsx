"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import type { BrainNode } from "@/lib/brain/graph";
import { GEOMETRY_OF, SYSTEM_COLOR, SYSTEM_OF, type NodeGeometry } from "@/components/brain/three/systems";
import { importanceOf } from "@/components/brain/importance";
import type { Vec3 } from "@/components/brain/three/layout3d";

const DAMP = 0.14;

function Geometry({ kind, size }: { kind: NodeGeometry; size: number }) {
  switch (kind) {
    case "icosahedron":
      return <icosahedronGeometry args={[size, 0]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[size * 1.15, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[size, 0]} />;
    case "sphere":
      return <sphereGeometry args={[size, 12, 10]} />;
    case "torus":
      return <torusGeometry args={[size, size * 0.34, 8, 20]} />;
    case "octahedron":
      return <octahedronGeometry args={[size * 1.1, 0]} />;
    case "ring":
      return <torusGeometry args={[size * 0.85, size * 0.16, 6, 24]} />;
    case "cone":
      return <coneGeometry args={[size * 0.75, size * 1.6, 8]} />;
    case "coneLarge":
      return <coneGeometry args={[size * 0.95, size * 1.9, 10]} />;
    case "hexPrism":
      return <cylinderGeometry args={[size * 0.85, size * 0.85, size * 1.1, 6]} />;
  }
}

export function EntityNodePoint({
  node,
  targetPosition,
  visualState,
  onSelect,
}: {
  node: BrainNode;
  targetPosition: Vec3;
  /** "normal" | "focused" (this or directly related to selection) | "dimmed" (unrelated during focus/dissect) */
  visualState: "normal" | "focused" | "dimmed";
  onSelect: (nodeId: string) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const posRef = useRef(new THREE.Vector3(...targetPosition));
  const system = SYSTEM_OF[node.type];
  const color = SYSTEM_COLOR[system];
  const weight = importanceOf(node);
  const size = 0.16 + weight * 0.14;

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const alpha = Math.min(1, DAMP * delta * 60);
    posRef.current.lerp(new THREE.Vector3(...targetPosition), alpha);
    meshRef.current.position.copy(posRef.current);
    meshRef.current.rotation.y += delta * 0.15;
  });

  const opacity = visualState === "dimmed" ? 0.14 : visualState === "focused" || hovered ? 1 : 0.85;
  const emissiveIntensity = visualState === "focused" ? 0.9 : hovered ? 0.7 : 0.35;

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
      <Geometry kind={GEOMETRY_OF[node.type]} size={size} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={emissiveIntensity}
        transparent
        opacity={opacity}
        roughness={0.35}
        metalness={0.3}
      />
      {hovered || visualState === "focused" ? (
        <Html distanceFactor={9} center style={{ pointerEvents: "none" }}>
          <div className="lab-mono whitespace-nowrap rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
            {node.label}
          </div>
        </Html>
      ) : null}
    </mesh>
  );
}
