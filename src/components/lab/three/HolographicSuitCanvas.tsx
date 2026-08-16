"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sparkles, ContactShadows } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SuitRig, type SuitRigProps } from "@/components/lab/three/SuitRig";

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
}

export function HolographicSuitCanvas({ autoRotate = false, ...rigProps }: HolographicSuitCanvasProps) {
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

      <ambientLight intensity={0.35} color="#a78bfa" />
      <directionalLight position={[2.5, 2.5, 2]} intensity={1.4} color="#c4b5fd" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-2, 0.5, -2]} intensity={2.2} color="#38bdf8" />
      <pointLight position={[0, -1.6, 1.5]} intensity={0.6} color="#a855f7" />

      <Suspense fallback={null}>
        <SuitRig {...rigProps} />
        <ProjectionPlatform color={rigProps.colorPrimary} />
        <ContactShadows position={[0, -1.33, 0]} opacity={0.5} scale={4.5} blur={2.4} far={2} color="#000000" />
        <Sparkles count={60} scale={[3, 3.5, 3]} size={2} speed={0.25} color="#c4b5fd" opacity={0.5} />
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
