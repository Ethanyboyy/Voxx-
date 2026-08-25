"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Points, LineSegments } from "three";
import type { BrainState } from "@/lib/brain/graph";
import { buildNeuralWeb } from "@/components/brain/three/brainGeometry";

// Cooler, telemetry-toned blues/cyans for the network itself — the same
// --accent-blue/--core-listening role this app already reserves for
// data-dense surfaces, kept distinct from the violet identity accent used
// on the shell's rim glow and the region hub markers.
const STATE_NODE_COLOR: Record<BrainState, string> = {
  idle: "#67e8f9",
  thinking: "#c084fc",
  researching: "#818cf8",
  executing: "#fbbf24",
  waiting: "#fbbf24",
  learning: "#38bdf8",
  error: "#f87171",
};

/**
 * The connectome presentation from the reference: a constellation of
 * glowing nodes tracing the real cortical surface (the exact same
 * anatomical shaping as the solid shell, just at low subdivision — see
 * buildNeuralWeb), connected by the mesh's own real triangle edges. This
 * is the PRIMARY visual read; the solid shell in BrainMesh is now a faint
 * translucent silhouette behind it, not the hero surface.
 */
export function NeuralWeb({ brainState, opacity }: { brainState: BrainState; opacity: number }) {
  const { positions, edges } = useMemo(() => buildNeuralWeb(2), []);
  const pointsRef = useRef<Points>(null);
  const linesRef = useRef<LineSegments>(null);

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

  const color = useMemo(() => new THREE.Color(STATE_NODE_COLOR[brainState]), [brainState]);

  useFrame(({ clock }) => {
    const pulse = 0.75 + Math.sin(clock.elapsedTime * 0.6) * 0.15;
    const pointsMat = pointsRef.current?.material as THREE.PointsMaterial | undefined;
    if (pointsMat) {
      pointsMat.color.copy(color);
      pointsMat.opacity = opacity * pulse;
    }
    const lineMat = linesRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (lineMat) {
      lineMat.color.copy(color);
      lineMat.opacity = opacity * 0.55 * pulse;
    }
  });

  return (
    <group>
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={opacity * 0.55} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={color} size={0.028} sizeAttenuation transparent opacity={opacity} toneMapped={false} depthWrite={false} />
      </points>
    </group>
  );
}
