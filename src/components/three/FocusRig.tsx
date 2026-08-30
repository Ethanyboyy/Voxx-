"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { approach } from "@/lib/3d/animation";
import { distanceForRadius } from "@/lib/3d/framing";

/**
 * The shared camera rig: flies to whatever is selected, on any 3D surface.
 *
 * Generalised out of the Lab's suit viewer so the Brain, gadget inspector and
 * lab equipment all move the same way. Camera motion is the most legible
 * signal of whether a product was designed as one thing, and two rigs easing
 * differently is immediately noticeable even when neither is wrong.
 *
 * The target is always derived from the selected objects' real world bounds,
 * never from a table of hand-tuned camera positions: assets here are posed and
 * assembled at runtime, so any hardcoded camera is wrong the moment the pose
 * changes — a class of bug this pipeline has already produced twice.
 */

export interface FocusTarget {
  center: THREE.Vector3;
  radius: number;
}

export interface FocusRigProps {
  controls: React.RefObject<OrbitControlsImpl | null>;
  /** Null returns the camera to the home framing. */
  target: FocusTarget | null;
  homePosition: [number, number, number];
  homeTarget: [number, number, number];
  /** Skips animation for users who asked for reduced motion. */
  reducedMotion?: boolean;
  /** Per-second convergence rate. Higher is snappier. */
  rate?: number;
  /** Framing margin; 1.0 is edge-to-edge, higher pulls back. */
  margin?: number;
}

/** Re-exported so existing importers keep working; the math lives in lib/3d. */
export { distanceForRadius as distanceFor } from "@/lib/3d/framing";

export function FocusRig({
  controls,
  target,
  homePosition,
  homeTarget,
  reducedMotion = false,
  rate = 6,
  margin = 1.9,
}: FocusRigProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.height > 0 ? size.width / size.height : 1;

  const desiredPos = useRef(new THREE.Vector3(...homePosition));
  const desiredTarget = useRef(new THREE.Vector3(...homeTarget));

  useEffect(() => {
    if (!target) {
      desiredPos.current.set(...homePosition);
      desiredTarget.current.set(...homeTarget);
      return;
    }

    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const dist = distanceForRadius(target.radius, fov, margin, aspect);

    // Approach along the CURRENT viewing direction rather than a fixed axis,
    // so focusing preserves whatever angle the user orbited to. Snapping to a
    // canned three-quarter view fights the user's own navigation, which is the
    // most common way this kind of feature becomes annoying.
    const dir = camera.position.clone().sub(desiredTarget.current);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.15, 1);
    dir.normalize();

    desiredTarget.current.copy(target.center);
    desiredPos.current.copy(target.center).addScaledVector(dir, dist);
  }, [target, camera, homePosition, homeTarget, margin, aspect]);

  useFrame((_, delta) => {
    const ctl = controls.current;
    const k = reducedMotion ? 1 : approach(rate, delta);
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
 * The union is what gives assembly-level focus — framing a whole arm means
 * framing every piece mounted on it, and a union is the only honest way to
 * compute that for geometry that moves.
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

/** Resolves ids to objects via a registry, then unions their bounds. */
export function boundsOfIds(
  registry: Map<string, THREE.Object3D>,
  ids: string[],
): FocusTarget | null {
  const objects = ids.map((id) => registry.get(id)).filter((o): o is THREE.Object3D => !!o);
  return boundsOf(objects);
}
