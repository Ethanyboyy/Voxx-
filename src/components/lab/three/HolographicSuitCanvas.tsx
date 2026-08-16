"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sparkles, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SuitRig, type SuitRigProps } from "@/components/lab/three/SuitRig";
import { GltfSuitModel, GltfErrorBoundary } from "@/components/lab/three/GltfSuitModel";

/**
 * Procedural three-point studio softbox — every "light" here is a plain
 * emissive plane baked into a small reflection/irradiance map at runtime
 * (no HDRI file, no network fetch). This is what makes metal/fabric/composite
 * materials read as real surfaces instead of flat color swatches. The suit
 * must look correct with this environment and the neutral key/fill/rim
 * lights below ALONE — the accent-colored point lights further down are a
 * rim/identity tint only and are never load-bearing for the material read.
 */
function StudioEnvironment() {
  return (
    <Environment resolution={256} background={false}>
      <Lightformer form="rect" intensity={2.4} color="#fdfbf7" position={[3, 3.5, 4]} scale={[3.5, 5, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.8} color="#eef1fb" position={[-4, 1, 2.5]} scale={[3, 4, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={1.5} color="#f5f0ff" position={[0, 2, -4]} scale={[4, 3, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={0.4} color="#e9e4f5" position={[0, -3, 1]} scale={3} target={[0, 0, 0]} />
    </Environment>
  );
}

/** Holographic projection ring beneath the suit — a stack of thin torus
 * rings standing in for the "projection platform" a lab-grade hologram
 * would emit from. Pure procedural geometry, no external assets. */
function ProjectionPlatform({ color }: { color: string }) {
  return (
    <group position={[0, -1.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[0.62 + i * 0.08, 0.625 + i * 0.08, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.35 - i * 0.09} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export interface HolographicSuitCanvasProps extends SuitRigProps {
  autoRotate?: boolean;
  /** Decorative holographic dressing — sparkles + projection platform rings.
   * Defaults on for the lab aesthetic, but the suit itself must read
   * correctly with this off: that's the acceptance test for the lighting
   * and material work, not just an option nobody uses. */
  showEffects?: boolean;
  /** Path to a real .glb/.gltf asset (e.g. "/models/suits/mk-vii.glb"). When
   * set, this REPLACES the procedural SuitRig with the actual file — every
   * suit today has this unset and renders procedurally. Falls back to the
   * procedural rig if the file is missing or fails to load. */
  modelUrl?: string | null;
}

export function HolographicSuitCanvas({
  autoRotate = false,
  showEffects = true,
  modelUrl,
  ...rigProps
}: HolographicSuitCanvasProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [1.9, -0.05, 3.5], fov: 30 }}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={["#050212"]} />
      <fog attach="fog" args={["#050212", 5, 11]} />

      <StudioEnvironment />

      {/* Neutral key / fill / rim — this trio carries the actual material
          read, independent of any accent color or glow effect. */}
      <ambientLight intensity={0.18} color="#ffffff" />
      <directionalLight
        position={[3, 4, 3]}
        intensity={1.7}
        color="#fdfbf7"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3.5, 1.5, 1.5]} intensity={0.45} color="#eef1fb" />
      <directionalLight position={[0, 2, -4]} intensity={0.75} color="#f5f0ff" />

      {/* Accent rim — identity tint only, dimmed further (not removed) when
          effects are off so the studio lighting is doing the real work. */}
      <pointLight position={[-2, 0.5, -2]} intensity={showEffects ? 0.5 : 0.12} color="#38bdf8" />
      <pointLight position={[0, -1.6, 1.5]} intensity={showEffects ? 0.35 : 0.08} color="#a855f7" />

      <Suspense fallback={null}>
        {modelUrl ? (
          <GltfErrorBoundary fallback={<SuitRig {...rigProps} />}>
            <GltfSuitModel url={modelUrl} />
          </GltfErrorBoundary>
        ) : (
          <SuitRig {...rigProps} />
        )}
        {showEffects ? <ProjectionPlatform color={rigProps.colorPrimary} /> : null}
        <ContactShadows position={[0, -1.33, 0]} opacity={0.5} scale={4.5} blur={2.4} far={2} color="#000000" />
        {showEffects ? (
          <Sparkles count={60} scale={[3, 3.5, 3]} size={2} speed={0.25} color="#c4b5fd" opacity={0.5} />
        ) : null}
      </Suspense>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        panSpeed={0.5}
        minDistance={2}
        maxDistance={6}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI - 0.35}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        target={[0, -0.2, 0]}
      />
    </Canvas>
  );
}
