"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { BufferGeometry, LineSegments } from "three";
import type { BrainEdge } from "@/lib/brain/graph";

export interface ResolvedEdge {
  edge: BrainEdge;
  from: [number, number, number];
  to: [number, number, number];
}

/**
 * All real edges from getBrainGraph(), drawn as two tiers: a single batched
 * lineSegments buffer for ordinary/background connections (cheap — one draw
 * call regardless of edge count), and individually animated dashed Line
 * components only for the small set currently highlighted by a selection
 * (relationship tracing). Positions resolve to a real node's current
 * position when revealed, or its system anchor otherwise — so a connection
 * between two not-yet-drilled-into systems still reads as a real line
 * between those two anchors rather than disappearing.
 */
export function EdgeLines({
  resolved,
  highlightedIds,
  dimmed,
}: {
  resolved: ResolvedEdge[];
  highlightedIds: Set<string>;
  dimmed: boolean;
}) {
  const background = useMemo(() => resolved.filter((r) => !highlightedIds.has(r.edge.id)), [resolved, highlightedIds]);
  const highlighted = useMemo(() => resolved.filter((r) => highlightedIds.has(r.edge.id)), [resolved, highlightedIds]);

  const lineRef = useRef<LineSegments>(null);
  const geometryRef = useRef<BufferGeometry | null>(null);

  useEffect(() => {
    const positions = new Float32Array(background.length * 6);
    background.forEach((r, i) => {
      positions.set(r.from, i * 6);
      positions.set(r.to, i * 6 + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometryRef.current = geometry;
    if (lineRef.current) lineRef.current.geometry = geometry;
    return () => geometry.dispose();
  }, [background]);

  // Background edges track their endpoints' damped motion too, but only
  // needs a modest refresh rate — this is context, not the focal element.
  const frameCount = useRef(0);
  useFrame(() => {
    frameCount.current += 1;
    if (frameCount.current % 3 !== 0) return;
    const geometry = geometryRef.current;
    if (!geometry) return;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    background.forEach((r, i) => {
      attr.array[i * 6] = r.from[0];
      attr.array[i * 6 + 1] = r.from[1];
      attr.array[i * 6 + 2] = r.from[2];
      attr.array[i * 6 + 3] = r.to[0];
      attr.array[i * 6 + 4] = r.to[1];
      attr.array[i * 6 + 5] = r.to[2];
    });
    attr.needsUpdate = true;
  });

  return (
    <group>
      {background.length > 0 ? (
        <lineSegments ref={lineRef}>
          <bufferGeometry />
          <lineBasicMaterial color="#a855f7" transparent opacity={dimmed ? 0.05 : 0.16} />
        </lineSegments>
      ) : null}
      {highlighted.map((r) => (
        <Line
          key={r.edge.id}
          points={[r.from, r.to]}
          color="#e9d5ff"
          lineWidth={1.5}
          transparent
          opacity={0.9}
          dashed
          dashSize={0.18}
          gapSize={0.1}
        />
      ))}
    </group>
  );
}
