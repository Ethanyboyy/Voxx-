"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { Vec3 } from "@/components/brain/three/layout3d";

const DAMP = 0.09;

/**
 * Smoothly pans/zooms toward whatever the app wants focused (whole brain,
 * a system, a single entity) while leaving the user's own orbit angle
 * alone — only the orbit target and camera distance from it are damped
 * toward the new focus each frame; the direction the user last rotated to
 * is preserved (offset vector is rotated forward, not reset).
 */
export function CameraRig({
  focusPosition,
  focusDistance,
  reducedMotion,
  onControlsReady,
}: {
  focusPosition: Vec3;
  focusDistance: number;
  reducedMotion: boolean;
  onControlsReady?: (controls: OrbitControlsImpl) => void;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const targetVec = useRef(new THREE.Vector3(...focusPosition));
  const desiredDistance = useRef(focusDistance);

  useEffect(() => {
    targetVec.current.set(...focusPosition);
    desiredDistance.current = focusDistance;
  }, [focusPosition, focusDistance]);

  useEffect(() => {
    if (controlsRef.current && onControlsReady) onControlsReady(controlsRef.current);
  }, [onControlsReady]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const alpha = reducedMotion ? 1 : Math.min(1, DAMP * delta * 60);

    controls.target.lerp(targetVec.current, alpha);

    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = offset.length() || 1;
    const nextDistance = THREE.MathUtils.lerp(currentDistance, desiredDistance.current, alpha);
    offset.normalize().multiplyScalar(nextDistance);
    camera.position.copy(controls.target).add(offset);

    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={26}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
    />
  );
}
