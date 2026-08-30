"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/**
 * Progressive focus: the camera flies to whatever the user selected.
 *
 * This is what turns the viewer from a picture into something you inspect.
 * Selecting an arm frames the arm; selecting the web-shooter on that arm
 * frames the web-shooter; selecting its cartridge frames the cartridge. Each
 * step is a real camera move to a real object's bounds, not a modal opening
 * over the top of the scene.
 *
 * The target is derived from the selected object's own world bounding sphere
 * rather than from a table of hand-tuned camera positions. That matters
 * because the suit is posed at runtime and its parts are mounted to skeleton
 * joints — any hardcoded camera would be wrong the moment the pose changed,
 * which is exactly the class of bug this pipeline has already produced twice.
 */

export interface FocusTarget {
  center: THREE.Vector3;
  radius: number;
}

export interface FocusRigProps {
  controls: React.RefObject<OrbitControlsImpl | null>;
  /** Null returns the camera to the whole-suit framing. */
  target: FocusTarget | null;
  /** Home framing, used when nothing is selected. */
  homePosition: [number, number, number];
  homeTarget: [number, number, number];
  /** Skips animation for users who asked for reduced motion. */
  reducedMotion?: boolean;
}

/** Frames a sphere for the given vertical FOV, with a little breathing room. */
function distanceFor(radius: number, fovDegrees: number): number {
  const fov = THREE.MathUtils.degToRad(fovDegrees);
  // 1.9 rather than a tight 1.0 fit: a part framed edge-to-edge reads as a
  // crop, and the surrounding suit is what tells you WHERE the part is.
  return (radius * 1.9) / Math.tan(fov / 2);
}

export function FocusRig({ controls, target, homePosition, homeTarget, reducedMotion = false }: FocusRigProps) {
  const camera = useThree((s) => s.camera);

  const desiredPos = useRef(new THREE.Vector3(...homePosition));
  const desiredTarget = useRef(new THREE.Vector3(...homeTarget));

  useEffect(() => {
    if (!target) {
      desiredPos.current.set(...homePosition);
      desiredTarget.current.set(...homeTarget);
      return;
    }

    const fov = (camera as THREE.PerspectiveCamera).fov ?? 28;
    const dist = distanceFor(target.radius, fov);

    // Approach along the CURRENT viewing direction rather than a fixed axis,
    // so focusing preserves whatever angle the user had orbited to. Jumping to
    // a canned three-quarter view every time would fight the user's own
    // navigation, which is the most common way this kind of feature annoys.
    const dir = camera.position.clone().sub(desiredTarget.current);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.15, 1);
    dir.normalize();

    desiredTarget.current.copy(target.center);
    desiredPos.current.copy(target.center).addScaledVector(dir, dist);
  }, [target, camera, homePosition, homeTarget]);

  useFrame((_, delta) => {
    const ctl = controls.current;
    // Frame-rate independent easing: a fixed per-frame lerp runs at a
    // different speed on a 120Hz display than on a 30Hz one.
    const k = reducedMotion ? 1 : 1 - Math.exp(-6 * delta);
    camera.position.lerp(desiredPos.current, k);
    if (ctl) {
      ctl.target.lerp(desiredTarget.current, k);
      ctl.update();
    }
  });

  return null;
}

/**
 * World-space bounds of a set of objects, as a sphere.
 *
 * Union of several objects is what gives ASSEMBLY-level focus — framing the
 * whole left arm means framing every piece mounted on it, and the union is
 * the only honest way to compute that for geometry that moves with the pose.
 */
export function boundsOf(objects: THREE.Object3D[]): FocusTarget | null {
  if (objects.length === 0) return null;
  const box = new THREE.Box3();
  let any = false;
  for (const obj of objects) {
    const b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) continue;
    if (any) box.union(b);
    else box.copy(b);
    any = true;
  }
  if (!any) return null;

  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { center, radius: Math.max(size.x, size.y, size.z) / 2 || 0.05 };
}
