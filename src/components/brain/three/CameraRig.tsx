"use client";

import { useEffect, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { Vec3 } from "@/components/brain/three/anatomy";

const DAMP = 0.09;
const IDLE_RESUME_MS = 3500;

/**
 * Smoothly pans/zooms toward whatever the app wants focused (whole brain,
 * a region, a single entity) while leaving the user's own orbit angle
 * alone — only the orbit target and camera distance from it are damped
 * toward the new focus each frame; the direction the user last rotated to
 * is preserved (offset vector is rotated forward, not reset).
 *
 * Also owns the idle auto-rotate behavior: a slow cinematic spin that
 * yields the instant the user grabs the brain (OrbitControls' own
 * 'start'/'end' events, not a naive "run alongside user input" autoRotate)
 * and only resumes after a few seconds of no further interaction.
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
  const [autoRotate, setAutoRotate] = useState(true);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    targetVec.current.set(...focusPosition);
    desiredDistance.current = focusDistance;
  }, [focusPosition, focusDistance]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (onControlsReady) onControlsReady(controls);

    function handleStart() {
      setAutoRotate(false);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    }
    function handleEnd() {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => setAutoRotate(true), IDLE_RESUME_MS);
    }
    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);
    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
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
      minDistance={0.5}
      maxDistance={9}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      autoRotate={autoRotate && !reducedMotion}
      autoRotateSpeed={0.35}
    />
  );
}
