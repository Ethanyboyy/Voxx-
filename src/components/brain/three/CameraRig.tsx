"use client";

import { useEffect, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { Vec3 } from "@/components/brain/three/anatomy";
import { portraitPullback, verticalBiasOffset } from "@/lib/3d/framing";

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
  forceRotate,
}: {
  focusPosition: Vec3;
  focusDistance: number;
  reducedMotion: boolean;
  onControlsReady?: (controls: OrbitControlsImpl) => void;
  /** Explicit "Rotate" toolbar button — keeps spinning regardless of the
      idle-yield timer below, until the user turns it off again or grabs
      the brain (which still yields immediately, same as idle auto-rotate). */
  forceRotate?: boolean;
}) {
  const { camera } = useThree();
  const size = useThree((s) => s.size);
  // A camera's fov is VERTICAL, so a portrait canvas sees a much narrower
  // horizontal field — at 390x724 roughly half a desktop's. Every focus
  // distance below is authored against a landscape canvas, so on a phone the
  // brain was framed correctly top-to-bottom and cropped off both edges.
  // Pulling back by 1/aspect on portrait viewports is what makes the same
  // distances mean the same framing on any screen shape.
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const pullback = portraitPullback(aspect);

  // On a phone the bottom of the canvas is not empty: the activity feed and
  // inspector cards sit over roughly its lower half. Centring the brain in the
  // CANVAS therefore centres it behind the UI. Biasing the orbit target down in
  // world space lifts the subject into the part of the frame the user can
  // actually see. Zero on landscape, where nothing covers the middle.
  const biasFraction = aspect < 1 ? 0.16 : 0;

  const controlsRef = useRef<OrbitControlsImpl>(null);
  const targetVec = useRef(new THREE.Vector3(...focusPosition));
  const desiredDistance = useRef(focusDistance * pullback);
  const [autoRotate, setAutoRotate] = useState(true);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const distance = focusDistance * pullback;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;
    targetVec.current.set(...focusPosition);
    // The bias is a fraction of the visible world height at this distance, so
    // the subject lands at the same place in frame whatever the zoom level.
    targetVec.current.y -= verticalBiasOffset(distance, fov, biasFraction);
    desiredDistance.current = distance;
  }, [focusPosition, focusDistance, pullback, biasFraction, camera]);

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
      maxDistance={9 * pullback}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      autoRotate={(autoRotate || Boolean(forceRotate)) && !reducedMotion}
      autoRotateSpeed={0.35}
    />
  );
}
