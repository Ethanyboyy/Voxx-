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
 * rings plus a broad soft ground-glow disc, standing in for the
 * "projection platform" a lab-grade hologram would emit from — matching
 * the reference's dramatic under-lit pedestal rather than a few thin lines.
 * Pure procedural geometry, no external assets. */
function ProjectionPlatform({ color }: { color: string }) {
  return (
    <group position={[0, -1.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {/* Broad soft glow disc — the light actually seems to emanate from
          the floor, not just outline it. */}
      <mesh position={[0, 0, -0.002]}>
        <circleGeometry args={[0.95, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, -0.001]}>
        <circleGeometry args={[0.7, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} toneMapped={false} depthWrite={false} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[0.58 + i * 0.075, 0.588 + i * 0.075, 96]} />
          <meshBasicMaterial color={color} transparent opacity={0.55 - i * 0.09} toneMapped={false} depthWrite={false} />
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
  /** Visual QA mode (directive §21): forces a neutral clay material with no
   * pattern/emissive/rim-glow/emblem layers on a GLB-backed body, so raw
   * geometry can be judged under plain studio lighting alone. Procedural-rig
   * suits don't yet have an equivalent neutral-material path. */
  rawGeometry?: boolean;
}

export function HolographicSuitCanvas({
  autoRotate = false,
  showEffects = true,
  modelUrl,
  rawGeometry = false,
  ...rigProps
}: HolographicSuitCanvasProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // The procedural SuitRig is a small, chest-focused mannequin the camera
  // above was tuned for. A real GLB body (e.g. CesiumMan, loaded at its own
  // T-pose bind pose — see GltfSuitModel.tsx) is a full CANONICAL_BODY_HEIGHT
  // figure with arms held out from its sides, needing a further-back, more
  // head-on framing to fit the whole figure instead of cropping into one limb.
  const cameraPosition: [number, number, number] = modelUrl ? [0, -0.15, 4.4] : [1.5, -0.05, 2.7];
  const orbitTarget: [number, number, number] = modelUrl ? [0, -0.45, 0] : [0, -0.2, 0];

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cameraPosition, fov: 27 }}
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

      {/* Platform up-light — the suit's own hero color, cast upward from
          floor level, so the pedestal genuinely reads as the light source
          it's drawn as, uplighting the suit's underside. */}
      {showEffects ? <pointLight position={[0, -1.3, 0.3]} intensity={0.9} distance={3} decay={2} color={rigProps.colorPrimary} /> : null}

      <Suspense fallback={null}>
        {modelUrl ? (
          <GltfErrorBoundary fallback={<SuitRig {...rigProps} />}>
            <GltfSuitModel
              url={modelUrl}
              colorPrimary={rigProps.colorPrimary}
              colorSecondary={rigProps.colorSecondary}
              materialLanguage={rigProps.materialLanguage}
              patternStyle={rigProps.patternStyle}
              xray={rigProps.xray}
              showEffects={showEffects}
              rawGeometry={rawGeometry}
            />
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
        minDistance={modelUrl ? 2.4 : 1.6}
        maxDistance={modelUrl ? 9 : 6}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI - 0.35}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        target={orbitTarget}
      />
    </Canvas>
  );
}
