"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
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
    <Environment resolution={512} background={false}>
      <Lightformer form="rect" intensity={1.5} color="#fffdf8" position={[3, 3.5, 4]} scale={[3.5, 5, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.5} color="#eef0f4" position={[-4, 1, 2.5]} scale={[3, 4, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#f4f5f8" position={[0, 2, -4]} scale={[4, 3, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={0.4} color="#e8e9ee" position={[0, -3, 1]} scale={3} target={[0, 0, 0]} />
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

/**
 * The real human body asset every suit is built on.
 *
 * This is a default, not a per-suit opt-in, and that is the whole fix: 59 of
 * 60 suits had no modelUrl and fell through to the procedural rig, so the
 * archive rendered as sixty blobby primitive mannequins while one suit used
 * the real 49k-triangle asset. A suit is a garment on a body — the body
 * should not vary per row.
 *
 * Three.js Xbot, MIT licensed. See public/models/body/README.md.
 */
export const DEFAULT_BODY_MODEL_URL = "/models/body/xbot.glb";

export interface HolographicSuitCanvasProps extends SuitRigProps {
  /** Identity inputs for the suit build (armour layout + surface set). */
  archetype?: string;
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
  archetype = "Utility",
  ...rigProps
}: HolographicSuitCanvasProps) {
  // Every suit renders on the real body unless it ships its own asset. The
  // procedural rig stays only as the error-boundary fallback below, which is
  // the role it can actually fill honestly.
  const bodyUrl = modelUrl ?? DEFAULT_BODY_MODEL_URL;
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // The procedural SuitRig is a small, chest-focused mannequin the camera
  // above was tuned for. A real GLB body (e.g. CesiumMan, loaded at its own
  // T-pose bind pose — see GltfSuitModel.tsx) is a full CANONICAL_BODY_HEIGHT
  // figure with arms held out from its sides, needing a further-back, more
  // head-on framing to fit the whole figure instead of cropping into one limb.
  // Framed for a posed figure, not a T-pose. A T-pose is nearly as wide as it
  // is tall, so it needed the camera pulled well back; arms-down is roughly a
  // third of that width and the same framing left the suit small in a mostly
  // empty frame. Closer, and off-axis rather than dead-on — a dead-on
  // elevation reads as a spec drawing, a slight three-quarter reads as an
  // object in a room.
  // Distance is set by the figure's HEIGHT once the arms are down: at fov 30 a
  // 1.75-unit body needs ~3.3 to fit, and 2.6 cropped the head and the feet.
  // The lateral offset stays small — enough to read as a three-quarter view
  // rather than a spec elevation, not enough to hide the far arm.
  // Tightened toward the product-render reference — a slightly longer lens
  // (28 vs 30) and less empty margin, so the figure carries more of the frame.
  //
  // It was tighter still, cropping at the calf the way a hero product shot
  // crops. Rendering that showed why the asset cannot cash that cheque yet:
  // at hero scale the pelvis, hands and chest plate all fail, and a crop that
  // close reads as an accident rather than a decision. The composition stays
  // where the geometry can support it, and moves in when the geometry earns it.
  const cameraPosition: [number, number, number] = [0.46, -0.04, 3.45];
  const orbitTarget: [number, number, number] = [0, -0.42, 0];

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cameraPosition, fov: 28 }}
      // ACES keeps the key light's specular hits on armour and metal from
      // clipping to flat white, which is what made every material read the
      // same at the highlight regardless of its roughness.
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={["#07070a"]} />
      <fog attach="fog" args={["#07070a", 4.2, 9]} />

      <StudioEnvironment />

      {/* Neutral key / fill / rim — this trio carries the actual material
          read, independent of any accent color or glow effect. */}
      {/* Ambient is deliberately low. Raising it to "see the suit better"
          flattens exactly the shading that distinguishes a woven panel from
          a hard plate — the plates have to earn their highlights from a real
          key light, not from a uniform wash. */}
      <ambientLight intensity={0.055} color="#f2f2f4" />

      {/* Key: high and to camera-right, shadow-casting. This is the light
          that reads the armour — its shadow is what proves a chest plate
          stands off the torso rather than being painted on it. */}
      <directionalLight
        position={[3.2, 4.2, 3]}
        intensity={1.3}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />

      {/* Fill: cool, opposite the key, low. Keeps the shadow side readable
          without erasing the form the key just described. */}
      <directionalLight position={[-3.6, 1.2, 2.2]} intensity={0.32} color="#dfe6f2" />

      {/* Rim from behind: separates the silhouette from the background.
          Strong enough to draw the shoulder and helmet edge, which is what
          makes the figure sit IN the scene instead of on it. */}
      <directionalLight position={[-1.2, 2.6, -4]} intensity={1.15} color="#f0f2f8" />
      <directionalLight position={[2.2, 1.4, -3.4]} intensity={0.7} color="#dce6f5" />

      {/* Accent rim — identity tint only, dimmed further (not removed) when
          effects are off so the studio lighting is doing the real work. */}
      <pointLight position={[-2, 0.5, -2]} intensity={showEffects ? 0.28 : 0.06} color="#38bdf8" />
      <pointLight position={[0, -1.6, 1.5]} intensity={showEffects ? 0.2 : 0.04} color="#a855f7" />

      {/* Platform up-light — the suit's own hero color, cast upward from
          floor level, so the pedestal genuinely reads as the light source
          it's drawn as, uplighting the suit's underside. */}
      {showEffects ? <pointLight position={[0, -1.3, 0.3]} intensity={0.9} distance={3} decay={2} color={rigProps.colorPrimary} /> : null}

      <Suspense fallback={null}>
        <GltfErrorBoundary fallback={<SuitRig {...rigProps} />}>
          <GltfSuitModel
            url={bodyUrl}
            colorPrimary={rigProps.colorPrimary}
            colorSecondary={rigProps.colorSecondary}
            materialLanguage={rigProps.materialLanguage}
            patternStyle={rigProps.patternStyle}
            xray={rigProps.xray}
            showEffects={showEffects}
            rawGeometry={rawGeometry}
            archetype={archetype}
            silhouette={rigProps.silhouette}
            armorLevel={rigProps.armorLevel}
            maskLensStyle={rigProps.maskLensStyle}
            explodeAmount={rigProps.explodeAmount}
          />
        </GltfErrorBoundary>
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
        minDistance={2.4}
        maxDistance={9}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI - 0.35}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        target={orbitTarget}
      />
    </Canvas>
  );
}
