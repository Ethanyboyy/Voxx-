"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group, Mesh } from "three";
import type { BrainState } from "@/lib/brain/graph";
import { buildBrainParts } from "@/components/brain/three/brainGeometry";

const DAMP = 0.08;

const STATE_COLOR: Record<BrainState, string> = {
  idle: "#8b86a8",
  thinking: "#c084fc",
  researching: "#818cf8",
  executing: "#fbbf24",
  waiting: "#fbbf24",
  learning: "#38bdf8",
  error: "#f87171",
};

const STATE_PULSE_SPEED: Record<BrainState, number> = {
  idle: 0.3,
  thinking: 0.9,
  researching: 1.05,
  executing: 1.4,
  waiting: 1.6,
  learning: 0.85,
  error: 1.9,
};

export type ClipAxis = "x" | "y" | "z";

interface Part {
  key: "left" | "right" | "cerebellum" | "brainstem" | "corpusCallosum";
  geometry: THREE.BufferGeometry;
  basePosition: [number, number, number];
  explodeOffset: [number, number, number];
  rotation?: [number, number, number];
  /** Base surface color — the ANATOMY reads first; this is a pale, almost-neutral lavender-grey, not neon. */
  color: string;
  /** Fades toward 0 opacity as the parts separate (a connecting band has no coherent shape once its endpoints are far apart). */
  fadesWhenExploded?: boolean;
}

function useParts(): Part[] {
  return useMemo(() => {
    const geo = buildBrainParts();
    return [
      { key: "right", geometry: geo.right, basePosition: [0, 0, 0], explodeOffset: [0.55, 0.05, 0], color: "#cdc6e8" },
      { key: "left", geometry: geo.left, basePosition: [0, 0, 0], explodeOffset: [-0.55, 0.05, 0], color: "#c3bce0" },
      { key: "cerebellum", geometry: geo.cerebellum, basePosition: [0, -0.64, -0.74], explodeOffset: [0, -0.4, -0.4], color: "#b9b2da" },
      {
        key: "brainstem",
        geometry: geo.brainstem,
        basePosition: [0, -0.56, -0.28],
        explodeOffset: [0, -0.3, -0.18],
        rotation: [0.28, 0, 0],
        color: "#a79fd0",
      },
      {
        key: "corpusCallosum",
        geometry: geo.corpusCallosum,
        basePosition: [0, 0.08, 0.02],
        explodeOffset: [0, 0.05, 0],
        rotation: [0, Math.PI / 2, Math.PI / 2],
        color: "#e0d9f7",
        fadesWhenExploded: true,
      },
    ];
  }, []);
}

function PartMesh({
  part,
  explodeAmount,
  xray,
  clipPlanes,
  emissiveColor,
  pulseRef,
}: {
  part: Part;
  explodeAmount: number;
  xray: boolean;
  clipPlanes: THREE.Plane[];
  emissiveColor: THREE.Color;
  /** A ref (not a value) — pulse is written every frame by the parent's own
      useFrame, and must be read fresh here each frame too. Passing the
      .current number as a prop instead would freeze it at whatever it was
      during the last actual React re-render, since mutating a ref never
      triggers one. */
  pulseRef: MutableRefObject<number>;
}) {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  const rimRef = useRef<Mesh>(null);
  const targetPos = useRef(new THREE.Vector3(...part.basePosition));

  useFrame((_, delta) => {
    const explodeVec = new THREE.Vector3(...part.explodeOffset).multiplyScalar(explodeAmount);
    targetPos.current.set(part.basePosition[0] + explodeVec.x, part.basePosition[1] + explodeVec.y, part.basePosition[2] + explodeVec.z);
    if (groupRef.current) {
      const alpha = Math.min(1, DAMP * delta * 60);
      groupRef.current.position.lerp(targetPos.current, alpha);
    }
    const mat = meshRef.current?.material as THREE.MeshPhysicalMaterial | undefined;
    if (mat) {
      mat.emissive.copy(emissiveColor);
      mat.emissiveIntensity = pulseRef.current;
      const targetOpacity = part.fadesWhenExploded ? Math.max(0, 1 - explodeAmount * 2.2) : xray ? 0.32 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, Math.min(1, 0.12 * delta * 60));
      mat.depthWrite = !xray && !(part.fadesWhenExploded && explodeAmount > 0.4);
    }
    const rimMat = rimRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (rimMat) rimMat.opacity = xray ? 0.22 : 0.1;
  });

  return (
    <group ref={groupRef} position={part.basePosition} rotation={part.rotation ?? [0, 0, 0]}>
      <mesh ref={meshRef} geometry={part.geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.56}
          metalness={0.03}
          transmission={0.1}
          thickness={0.6}
          ior={1.3}
          clearcoat={0.15}
          clearcoatRoughness={0.55}
          transparent
          opacity={1}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
          clipShadows
        />
      </mesh>
      {/* Rim-glow shell — same proven BackSide-additive technique as the
          prior milestone's CoreOrb, now wrapping real anatomy instead of a
          sphere: a holographic edge treatment that enhances the brain
          rather than hiding it (per the brief's material hierarchy). */}
      <mesh ref={rimRef} geometry={part.geometry} scale={1.015}>
        <meshBasicMaterial color="#a855f7" transparent opacity={0.1} side={THREE.BackSide} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function BrainMesh({
  brainState,
  explodeAmount,
  xray,
  clipEnabled,
  clipAxis,
  clipPosition,
}: {
  brainState: BrainState;
  explodeAmount: number;
  xray: boolean;
  clipEnabled: boolean;
  clipAxis: ClipAxis;
  clipPosition: number;
}) {
  const parts = useParts();
  const emissiveColor = useMemo(() => new THREE.Color(STATE_COLOR[brainState]), [brainState]);
  const pulseRef = useRef(0.18);

  // A fresh Plane per (axis, position) rather than mutating a memoized one
  // in an effect — react-hooks/immutability flags in-place mutation of a
  // useMemo result, and a new lightweight Plane instance is cheap anyway.
  const clipPlane = useMemo(() => {
    const normal = clipAxis === "x" ? new THREE.Vector3(1, 0, 0) : clipAxis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    return new THREE.Plane(normal, clipPosition);
  }, [clipAxis, clipPosition]);

  useEffect(() => {
    return () => {
      for (const part of parts) part.geometry.dispose();
    };
  }, [parts]);

  useFrame(({ clock }) => {
    const speed = STATE_PULSE_SPEED[brainState];
    pulseRef.current = 0.16 + (0.5 + Math.sin(clock.elapsedTime * speed) * 0.5) * 0.22;
  });

  const clipPlanes = clipEnabled ? [clipPlane] : [];

  return (
    <group>
      {parts.map((part) => (
        <PartMesh key={part.key} part={part} explodeAmount={explodeAmount} xray={xray} clipPlanes={clipPlanes} emissiveColor={emissiveColor} pulseRef={pulseRef} />
      ))}
      {/* Deep internal glow — a small, mostly-occluded core light standing in
          for "cognitive activity happening somewhere inside," genuinely
          visible only once X-Ray or Dissection reveals the interior. */}
      <pointLight position={[0, 0.05, 0.1]} color={emissiveColor} intensity={xray ? 3.2 : 1.1} distance={2.4} decay={2} />
    </group>
  );
}
