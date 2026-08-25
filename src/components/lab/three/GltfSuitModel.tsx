"use client";

import { Component, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

/**
 * Every suit/body GLB in this app is normalized to stand this tall (in
 * scene units) — the ONE canonical body reference the camera, platform, and
 * every other GLB-driven suit are framed against, regardless of how the
 * source asset was authored/scaled. See CLAUDE.md's build discipline: no
 * per-suit invented proportions.
 */
export const CANONICAL_BODY_HEIGHT = 1.75;
/** Matches the existing ProjectionPlatform/ContactShadows y-position in
 * HolographicSuitCanvas.tsx — the floor every body/suit asset should stand
 * on, not just wherever its own authored origin happened to land. */
export const CANONICAL_FEET_Y = -1.3;

/**
 * CesiumMan-specific corrective rotation. Verified by three independent
 * methods (direct Vector3.applyQuaternion probing, manual column-reading of
 * the composed Object3D.matrix, and the textbook quaternion→matrix formula)
 * that this rotation sends this scene's pre-rotation local X axis (where
 * this asset's height actually lands once its own "Z_UP"-named root's baked
 * loader matrix and its Armature's baked matrix are composed — NOT the raw
 * glTF accessor's Z axis, which is a different, earlier frame) to world Y.
 *
 * This rotation is applied directly to a pre-computed, pre-rotation
 * bounding box (see normalizeToCanonicalBody) rather than by rotating the
 * live scene and re-measuring with Box3.setFromObject: that re-measurement
 * path is unreliable specifically for this SkeletonUtils-cloned bone
 * hierarchy — every rotation tried against it (including this exact one)
 * came back from Box3 with the same stale, pre-rotation-shaped box despite
 * the quaternion itself reading back correctly, while the analytic
 * (Vector3.applyQuaternion on a plain point) path gives consistent,
 * independently-verified answers every time. Do not "fix" this by calling
 * Box3.setFromObject again after rotating — re-verify with a fresh
 * Vector3.applyQuaternion probe instead.
 */
const CESIUM_MAN_CORRECTIVE_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)),
);

/**
 * Real assets are not authored at a consistent scale, orientation, or
 * origin. CesiumMan (the first real body asset wired into this pipeline)
 * needs CESIUM_MAN_CORRECTIVE_ROTATION (see its own doc comment for why).
 * This measures the scene's real bounding box BEFORE any rotation (trusted
 * — see above), derives height/center from whichever pre-rotation axis
 * actually holds this asset's height (X, for CesiumMan — confirmed via its
 * own loaded scene graph), analytically rotates that center through the
 * corrective rotation, then centers on X/Z, sits the feet at
 * CANONICAL_FEET_Y, and scales to CANONICAL_BODY_HEIGHT.
 */
function normalizeToCanonicalBody(scene: THREE.Object3D): THREE.Object3D {
  let hasZUpRoot = false;
  scene.traverse((obj) => {
    if (obj.name === "Z_UP") hasZUpRoot = true;
  });

  if (hasZUpRoot) {
    // Measure and transform BEFORE touching skinning — see this asset's own
    // doc comments above for why the post-rotation Box3 path is unreliable
    // on this hierarchy, and CESIUM_SKINNING_UNRELIABLE below for why
    // skinning itself gets swapped out afterward, not before.
    const box0 = new THREE.Box3().setFromObject(scene);
    const trueHeight = box0.max.x - box0.min.x;
    const center0 = new THREE.Vector3();
    box0.getCenter(center0);

    scene.quaternion.copy(CESIUM_MAN_CORRECTIVE_ROTATION);
    const rotatedCenter = center0.clone().applyQuaternion(CESIUM_MAN_CORRECTIVE_ROTATION);

    if (trueHeight > 0) {
      const scale = CANONICAL_BODY_HEIGHT / trueHeight;
      scene.scale.setScalar(scale);
      scene.position.set(
        -rotatedCenter.x * scale,
        CANONICAL_FEET_Y - (rotatedCenter.y - trueHeight / 2) * scale,
        -rotatedCenter.z * scale,
      );
    }
  }

  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.frustumCulled = false;
      const mesh = obj as THREE.Mesh;
      // CESIUM_SKINNING_UNRELIABLE: CesiumMan ships no AnimationClip (there
      // is nothing to pose it with), yet its cloned SkinnedMesh renders in a
      // dramatically different, badly-distorted silhouette from its own
      // rest-pose geometry.boundingBox — confirmed by comparing the two
      // directly. Since there is no animation to lose, this swaps in a
      // plain Mesh sharing the same (rest-pose) geometry/material instead of
      // paying the live GPU-skinning cost for a pose that isn't usable
      // anyway. A future animated asset should NOT get this treatment.
      if (hasZUpRoot && (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const plain = new THREE.Mesh(mesh.geometry, mesh.material);
        plain.frustumCulled = false;
        mesh.parent?.add(plain);
        mesh.visible = false;
      }
    }
  });

  if (hasZUpRoot) {
    return scene;
  }

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  if (size.y > 0) {
    const scale = CANONICAL_BODY_HEIGHT / size.y;
    scene.scale.setScalar(scale);
    scene.position.set(-center.x * scale, CANONICAL_FEET_Y - box.min.y * scale, -center.z * scale);
  }

  return scene;
}

/**
 * Renders a real .glb/.gltf body/suit asset via drei's useGLTF — the "drop
 * a real file in and it just works" half of the architecture. SkeletonUtils
 * clones the scene per-instance (useGLTF caches and shares ONE scene graph
 * across every usage of the same url; naively reusing it directly would
 * corrupt other instances the moment this one's transform/skeleton is
 * touched — a real bug a plain `.clone()` wouldn't fix either, since it
 * doesn't preserve skinned-mesh bone bindings). Suspends while loading
 * (parent Canvas already wraps children in <Suspense>).
 */
export function GltfSuitModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => normalizeToCanonicalBody(SkeletonUtils.clone(gltf.scene)), [gltf.scene]);
  return <primitive object={scene} />;
}

interface GltfErrorBoundaryState {
  failed: boolean;
}

/**
 * A LabSuit.modelUrl can point at a file that doesn't exist yet, was moved,
 * or fails to parse — that must degrade to the procedural fallback, not
 * crash the whole holographic viewer. useGLTF throws inside R3F's render
 * tree, which only a class-based error boundary can catch (no functional
 * equivalent exists in React).
 */
export class GltfErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, GltfErrorBoundaryState> {
  state: GltfErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
