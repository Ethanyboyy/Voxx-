"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Points, LineSegments, Mesh } from "three";
import type { BrainState } from "@/lib/brain/graph";
import { buildNeuralWeb } from "@/components/brain/three/brainGeometry";

// A per-state emissive-intensity multiplier, not a flat replacement color —
// the network's actual hue now comes from the real cyan (low) -> violet
// (high) gradient baked into its own vertex colors (see brainGeometry.ts's
// gradientColorAt), matching the solid shell's rim glow. State still reads
// through brightness/pulse-speed (busier states glow harder and pulse
// faster), same as the rest of the app's telemetry convention, just without
// flattening the material to one hue.
const STATE_INTENSITY: Record<BrainState, number> = {
  idle: 0.85,
  thinking: 1.15,
  researching: 1.1,
  executing: 1.35,
  waiting: 1.2,
  learning: 1.1,
  error: 1.3,
};
const STATE_PULSE_SPEED: Record<BrainState, number> = {
  idle: 0.5,
  thinking: 0.9,
  researching: 1.0,
  executing: 1.4,
  waiting: 1.5,
  learning: 0.85,
  error: 1.8,
};

/**
 * The connectome presentation from the reference: a constellation of
 * glowing nodes tracing the real cortical surface (the exact same
 * anatomical shaping as the solid shell, just at low subdivision — see
 * buildNeuralWeb), connected by the mesh's own real triangle edges, colored
 * by the same world-space gradient as the shell's rim glow. A handful of
 * real high-degree "hub" nodes render as larger, brighter landmark markers
 * — the reference's bigger glowing junctions — distinct from the uniform
 * point cloud carrying the smaller dots. This is the PRIMARY visual read;
 * the solid shell in BrainMesh is now a faint translucent silhouette
 * behind it, not the hero surface.
 */
export function NeuralWeb({ brainState, opacity, xray = false, intensity: activityLevel = 0 }: { brainState: BrainState; opacity: number; xray?: boolean; intensity?: number }) {
  const { positions, edges, colors, hubs } = useMemo(() => buildNeuralWeb(2), []);
  const pointsRef = useRef<Points>(null);
  const linesRef = useRef<LineSegments>(null);
  const hubRefs = useRef<(Mesh | null)[]>([]);

  const linePositions = useMemo(() => {
    const arr = new Float32Array(edges.length * 3);
    for (let i = 0; i < edges.length; i++) {
      const nodeIndex = edges[i];
      arr[i * 3] = positions[nodeIndex * 3];
      arr[i * 3 + 1] = positions[nodeIndex * 3 + 1];
      arr[i * 3 + 2] = positions[nodeIndex * 3 + 2];
    }
    return arr;
  }, [positions, edges]);

  const lineColors = useMemo(() => {
    const arr = new Float32Array(edges.length * 3);
    for (let i = 0; i < edges.length; i++) {
      const nodeIndex = edges[i];
      arr[i * 3] = colors[nodeIndex * 3];
      arr[i * 3 + 1] = colors[nodeIndex * 3 + 1];
      arr[i * 3 + 2] = colors[nodeIndex * 3 + 2];
    }
    return arr;
  }, [colors, edges]);

  const hubData = useMemo(
    () =>
      hubs.map((i) => ({
        position: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] as [number, number, number],
        color: new THREE.Color(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]),
      })),
    [hubs, positions, colors]
  );

  // State says WHAT KIND of work; activity level says HOW MUCH. Multiplying
  // them means one memory lookup and three concurrent image attempts no longer
  // look identical — which was the whole point of counting them. Zero activity
  // multiplies to the state's own baseline, never below it, so an idle Brain
  // still reads as present rather than switched off.
  const intensity = STATE_INTENSITY[brainState] * (1 + activityLevel * 0.85);
  const pulseSpeed = STATE_PULSE_SPEED[brainState];

  useFrame(({ clock }) => {
    const pulse = 0.75 + Math.sin(clock.elapsedTime * pulseSpeed) * 0.15;
    // Anatomy first: the web recedes behind an opaque cortex and comes
    // forward only when the user asks to see inside.
    const depthScale = xray ? 1 : 0.22;
    const pointsMat = pointsRef.current?.material as THREE.PointsMaterial | undefined;
    if (pointsMat) pointsMat.opacity = opacity * pulse * intensity * depthScale;
    const lineMat = linesRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (lineMat) lineMat.opacity = opacity * 0.55 * pulse * intensity * depthScale;

    const hubPulse = 0.8 + Math.sin(clock.elapsedTime * pulseSpeed * 1.3) * 0.2;
    for (const mesh of hubRefs.current) {
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, opacity * 1.3 * hubPulse * intensity * depthScale);
      const s = 0.052 * hubPulse;
      mesh.scale.setScalar(s);
    }
  });

  return (
    <group>
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[lineColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={opacity * 0.55} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={0.028} sizeAttenuation transparent opacity={opacity} toneMapped={false} depthWrite={false} />
      </points>
      {/* Landmark hub markers — brighter, larger real-degree junctions with
          their own soft glow halo, matching the reference's bigger nodes. */}
      {hubData.map((hub, i) => (
        <group key={i} position={hub.position}>
          <mesh ref={(el) => { hubRefs.current[i] = el; }}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshBasicMaterial color={hub.color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh scale={0.11}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshBasicMaterial color={hub.color} transparent opacity={opacity * 0.18} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
