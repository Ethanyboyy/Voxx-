"use client";

import { useEffect, useMemo, type MutableRefObject } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import { listAssets, resolveLod, type QualityTierName } from "@/lib/3d/assetRegistry";

/**
 * The anatomical cortex, loaded from a real GLB when one is registered.
 *
 * WHY THIS EXISTS. Procedural displacement of a sphere was taken as far as it
 * reasonably goes — domain-warped, anisotropic, ridge-carved, Laplacian
 * smoothed — and it still reads as a lumpy mass rather than as a brain. The
 * reason is structural, not a matter of tuning: gyri are ribbons with coherent
 * global topology, and noise on a sphere produces bumps with none. Getting from
 * bumps to ribbons is not a parameter change, it is a different kind of data.
 *
 * So the cortex becomes an ASSET SLOT. Nothing else about the Brain changes:
 * the same `parts` contract, the same state colouring, the same clipping planes
 * for X-ray and cutaway, the same connectome and activity layers on top. Drop a
 * validated `brain` asset into public/models and register it in index.json and
 * this renders instead of the procedural mesh; with no asset registered this
 * component reports absence and BrainMesh keeps its procedural fallback, so the
 * Brain is never broken by the asset simply not being there yet.
 *
 * The pipeline is the one the Suit Bay already uses (src/lib/3d/assetRegistry
 * + assetLoader + drei's useGLTF, with per-tier LODs) — deliberately not a
 * second loader.
 */

/** Whether a usable anatomical brain asset is registered. */
export function anatomicalBrainUrl(tier: QualityTierName): string | null {
  const assets = listAssets("brain");
  if (assets.length === 0) return null;
  const lod = resolveLod(assets[0], tier);
  return lod?.url ?? null;
}

/**
 * The procedural cerebrum spans 0.95 along its longest (antero-posterior) axis
 * before folding, and every camera distance, region anchor and clip position in
 * the Brain is tuned to that. An imported asset is fitted to it rather than the
 * other way round.
 */
const TARGET_LONGEST_AXIS = 1.9;

export function AnatomicalBrainAsset({
  url,
  clipPlanes,
  emissiveColor,
  pulseRef,
  opacity,
}: {
  url: string;
  clipPlanes: THREE.Plane[];
  emissiveColor: THREE.Color;
  /** A ref, not a value: the pulse is written every frame by the parent's own
      useFrame and must be read fresh here each frame too. Reading .current
      during render would both freeze it at the last React re-render and access
      a ref during render, which is exactly what PartMesh already avoids. */
  pulseRef: MutableRefObject<number>;
  opacity: number;
}) {
  const gltf = useGLTF(url);

  // useGLTF caches and shares ONE scene graph across every consumer, so the
  // scene is cloned before its materials are touched — mutating the cached
  // original would leak this Brain's state colour into any other view that
  // loads the same asset. Same rule GltfSuitModel.tsx already follows.
  const { scene } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    // NORMALISE TO THE PROCEDURAL MESH'S BOUNDS. A third-party anatomical model
    // arrives in whatever units and origin its authors used — millimetres,
    // RAS-oriented, origin at a scanner landmark. Rather than recalibrating the
    // camera, the region anchors, the clipping planes and the satellite layout
    // to each asset, the ASSET is fitted to the space they already agree on:
    // centred on the origin and scaled so its longest axis matches the
    // procedural cerebrum's. Everything downstream then works unchanged, and
    // swapping the asset later cannot silently break the framing.
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = TARGET_LONGEST_AXIS / longest;
    clone.position.sub(centre);
    const wrapper = new THREE.Group();
    wrapper.add(clone);
    wrapper.scale.setScalar(scale);

    // Materials are cloned and configured HERE, as part of the same pure
    // derivation, rather than in an effect. An effect that writes a ref which
    // the frame loop then mutates is two owners for one value; this is one.
    const owned: THREE.MeshStandardMaterial[] = [];
    wrapper.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.Material;
      const material = source.clone() as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = opacity;
      // A depth-writing translucent surface hides everything inside it, which
      // would break X-ray and cutaway.
      material.depthWrite = opacity > 0.6;
      material.clippingPlanes = clipPlanes;
      material.clipShadows = true;
      if (material.emissive) material.emissive.copy(emissiveColor);
      mesh.material = material;
      // The state pulse is driven through three's own per-mesh render hook
      // rather than a React frame callback: the value lives in a ref that the
      // parent writes each frame, and going through onBeforeRender keeps the
      // mutation inside three's render pass instead of making React's compiler
      // reason about a memo value being written from a callback.
      mesh.onBeforeRender = () => {
        if (material.emissive) material.emissiveIntensity = pulseRef.current;
      };
      owned.push(material);
    });

    return { scene: wrapper, materials: owned };
  }, [gltf.scene, clipPlanes, emissiveColor, opacity, pulseRef]);

  // The cloned scene's materials are this component's own, so they are disposed
  // here; the cached geometry belongs to useGLTF and must NOT be freed.
  useEffect(
    () => () => {
      scene.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    },
    [scene],
  );

  return <primitive object={scene} />;
}
