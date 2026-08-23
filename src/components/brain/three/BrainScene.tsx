"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { BrainState } from "@/lib/brain/graph";
import { CameraRig } from "@/components/brain/three/CameraRig";
import { CoreOrb } from "@/components/brain/three/CoreOrb";
import type { Vec3 } from "@/components/brain/three/layout3d";

/**
 * The Canvas root: camera, lighting, the ambient environment, and the
 * always-present core. Entity/system geometry (task #94) mounts as
 * `children` so this file stays a stable scene shell.
 */
export function BrainScene({
  brainState,
  focusPosition,
  focusDistance,
  reducedMotion,
  onControlsReady,
  onPointerMissed,
  children,
}: {
  brainState: BrainState;
  focusPosition: Vec3;
  focusDistance: number;
  reducedMotion: boolean;
  onControlsReady?: (controls: OrbitControlsImpl) => void;
  onPointerMissed?: () => void;
  children?: ReactNode;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      camera={{ position: [0, 3, 13], fov: 50, near: 0.1, far: 100 }}
      onPointerMissed={onPointerMissed}
    >
      <color attach="background" args={["#030304"]} />
      <fog attach="fog" args={["#030304", 14, 34]} />

      <ambientLight intensity={0.35} color="#e9e4f5" />
      <directionalLight position={[6, 8, 6]} intensity={0.6} color="#f5f0ff" />
      <directionalLight position={[-8, -3, -4]} intensity={0.25} color="#38bdf8" />

      <Suspense fallback={null}>
        {reducedMotion ? null : <Sparkles count={90} scale={[22, 22, 22]} size={1.1} speed={0.12} color="#a855f7" opacity={0.18} />}
        <CoreOrb state={brainState} reducedMotion={reducedMotion} />
        {children}
      </Suspense>

      <CameraRig focusPosition={focusPosition} focusDistance={focusDistance} reducedMotion={reducedMotion} onControlsReady={onControlsReady} />
    </Canvas>
  );
}
