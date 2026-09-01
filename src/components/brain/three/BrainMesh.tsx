"use client";

import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group, Mesh } from "three";
import type { BrainState } from "@/lib/brain/graph";
import { buildBrainParts } from "@/components/brain/three/brainGeometry";
import { AnatomicalBrainAsset, anatomicalBrainUrl } from "@/components/brain/three/AnatomicalBrainAsset";
import { GltfErrorBoundary } from "@/components/lab/three/GltfSuitModel";
import { useQualityTier } from "@/lib/3d/useQualityTier";

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
  // Scratch vector reused every frame — see the note in EntitySatellite. Five
  // parts each allocated a Vector3 per frame purely to scale a constant.
  const explodeVec = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    explodeVec.current.set(...part.explodeOffset).multiplyScalar(explodeAmount);
    targetPos.current.set(
      part.basePosition[0] + explodeVec.current.x,
      part.basePosition[1] + explodeVec.current.y,
      part.basePosition[2] + explodeVec.current.z,
    );
    if (groupRef.current) {
      const alpha = Math.min(1, DAMP * delta * 60);
      groupRef.current.position.lerp(targetPos.current, alpha);
    }
    const mat = meshRef.current?.material as THREE.MeshPhysicalMaterial | undefined;
    if (mat) {
      mat.emissive.copy(emissiveColor);
      mat.emissiveIntensity = pulseRef.current;
      // THE ANATOMY IS THE HERO. This shell used to render at 0.15 opacity as
      // a "ghost silhouette" behind the connectome wireframe, which is why the
      // Brain read as a point cloud rather than as a brain: the cortical folds
      // were being carved into a surface nobody could see. The solid pass is
      // now opaque and depth-writing, so the sulci actually catch light and
      // occlude what is behind them; translucency is reserved for X-ray, where
      // seeing through the cortex is the whole point.
      const targetOpacity = part.fadesWhenExploded ? Math.max(0, 1 - explodeAmount * 2.2) : xray ? 0.22 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, Math.min(1, 0.12 * delta * 60));
      // Depth-write only when solid enough to be an occluder. A depth-writing
      // translucent surface hides everything inside it, which would break
      // X-ray and Dissect.
      mat.depthWrite = mat.opacity > 0.6;
    }
    const rimMat = rimRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (rimMat) rimMat.opacity = xray ? 0.3 : 0.07;
  });

  return (
    <group ref={groupRef} position={part.basePosition} rotation={part.rotation ?? [0, 0, 0]}>
      <mesh ref={meshRef} geometry={part.geometry}>
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.72}
          metalness={0}
          clearcoat={0.22}
          clearcoatRoughness={0.6}
          sheen={0.35}
          sheenRoughness={0.85}
          sheenColor="#b9a8ff"
          transparent
          opacity={1}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
          clipShadows
        />
      </mesh>
      {/* Rim-glow shell: the SAME geometry drawn again at a uniform scale-up.
          That was safe on a smooth shell, but once real sulci are carved a
          uniform scale no longer stays outside them — it erupts through the
          grooves as speckle. It is also a second full-geometry draw call per
          part, the wrong trade on a phone. X-ray still needs it, because a
          translucent cortex has to have its edge described somehow; the solid
          view reads its own silhouette from the lighting. */}
      {xray ? (
        <mesh ref={rimRef} geometry={part.geometry} scale={1.012}>
          <meshBasicMaterial color="#ffffff" vertexColors transparent opacity={0.22} side={THREE.BackSide} toneMapped={false} depthWrite={false} />
        </mesh>
      ) : null}
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
  intensity = 0,
}: {
  brainState: BrainState;
  explodeAmount: number;
  xray: boolean;
  clipEnabled: boolean;
  clipAxis: ClipAxis;
  clipPosition: number;
  /** 0..1, counted from live rows. Raises the pulse floor and its swing so a
      busy system visibly breathes harder than an idle one. */
  intensity?: number;
}) {
  const parts = useParts();
  const tier = useQualityTier();
  // A registered anatomical GLB replaces the procedural cortex entirely; with
  // none registered this is null and the procedural mesh renders, so the Brain
  // is never blank because an asset has not been bundled yet.
  const assetUrl = anatomicalBrainUrl(tier);
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
    // Activity raises both the floor and the swing. At intensity 0 this is
    // exactly the previous idle behaviour, so nothing shimmers on a system that
    // has done nothing.
    const floor = 0.05 + intensity * 0.05;
    const swing = 0.09 + intensity * 0.10;
    pulseRef.current = floor + (0.5 + Math.sin(clock.elapsedTime * speed) * 0.5) * swing;
  });

  const clipPlanes = clipEnabled ? [clipPlane] : [];

  // The procedural cortex, used three ways: as the render when no anatomical
  // asset is registered, as what shows WHILE one downloads, and as what shows
  // if that download fails. There is always a brain on screen.
  const procedural = parts.map((part) => (
    <PartMesh key={part.key} part={part} explodeAmount={explodeAmount} xray={xray} clipPlanes={clipPlanes} emissiveColor={emissiveColor} pulseRef={pulseRef} />
  ));

  return (
    <group>
      {assetUrl ? (
        // Two distinct failure modes, two distinct guards, and the same answer
        // to both. Suspense covers "not here yet" — a multi-megabyte anatomical
        // GLB over a phone hotspot is seconds of nothing, and BrainScene's
        // outer boundary falls back to null, which would blank the Brain
        // entirely. GltfErrorBoundary (reused from the Suit Bay, which hit this
        // first) covers "here but broken" — a 404 or a parse failure throws
        // during render, which only a class boundary can catch, and without one
        // a bad asset takes down the whole Brain tree rather than degrading.
        <GltfErrorBoundary fallback={<>{procedural}</>}>
          <Suspense fallback={<>{procedural}</>}>
            <AnatomicalBrainAsset
              url={assetUrl}
              clipPlanes={clipPlanes}
              emissiveColor={emissiveColor}
              pulseRef={pulseRef}
              opacity={xray ? 0.22 : 1}
            />
          </Suspense>
        </GltfErrorBoundary>
      ) : (
        procedural
      )}
      {/* Deep internal glow — a small, mostly-occluded core light standing in
          for "cognitive activity happening somewhere inside," genuinely
          visible only once X-Ray or Dissection reveals the interior. */}
      <pointLight position={[0, 0.05, 0.1]} color={emissiveColor} intensity={xray ? 3.2 : 1.1} distance={2.4} decay={2} />
    </group>
  );
}
