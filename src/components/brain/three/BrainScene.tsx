"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CameraRig } from "@/components/brain/three/CameraRig";
import type { Vec3 } from "@/components/brain/three/anatomy";

/**
 * The Canvas root: camera, lighting, the ambient environment. The
 * anatomical brain mesh and its region markers mount as `children` so this
 * file stays a stable scene shell. localClippingEnabled is on so the
 * cutaway/x-ray section-plane mode (BrainMesh) can actually clip geometry —
 * three.js requires this renderer flag before per-material clippingPlanes
 * have any effect.
 */
export function BrainScene({
  focusPosition,
  focusDistance,
  reducedMotion,
  onControlsReady,
  onPointerMissed,
  children,
}: {
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
      camera={{ position: [0.6, 0.5, 3.6], fov: 42, near: 0.05, far: 40 }}
      onPointerMissed={onPointerMissed}
      onCreated={({ gl }) => {
        // localClippingEnabled is a post-construction instance property in
        // three.js (not a WebGLRenderer constructor param — passing it via
        // the `gl={{...}}` object above would be silently ignored), so it
        // has to be set here via Canvas's onCreated instead.
        gl.localClippingEnabled = true;
      }}
      shadows
    >
      <color attach="background" args={["#030304"]} />
      <fog attach="fog" args={["#030304", 3.2, 9]} />

      {/* Lighting is deliberately directional/asymmetric rather than a flat
          ambient wash — the brief is explicit that folds must be visible,
          which needs real key/fill/rim contrast, not one emissive color. */}
      <ambientLight intensity={0.22} color="#d9d3f0" />
      <directionalLight position={[2.2, 3, 2.6]} intensity={1.5} color="#fbfaff" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2.6, 0.6, -1.4]} intensity={0.55} color="#38bdf8" />
      <directionalLight position={[0, -1.8, 1.5]} intensity={0.35} color="#a855f7" />
      <pointLight position={[0, 1.6, -2.4]} intensity={0.6} color="#c084fc" distance={8} decay={2} />

      <Suspense fallback={null}>
        {reducedMotion ? null : <Sparkles count={60} scale={[7, 6, 7]} size={0.9} speed={0.1} color="#a855f7" opacity={0.12} />}
        {children}
      </Suspense>

      <CameraRig focusPosition={focusPosition} focusDistance={focusDistance} reducedMotion={reducedMotion} onControlsReady={onControlsReady} />
    </Canvas>
  );
}
