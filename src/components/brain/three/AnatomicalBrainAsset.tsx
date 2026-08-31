"use client";

import { useEffect, useMemo } from "react";
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

export function AnatomicalBrainAsset({
  url,
  clipPlanes,
  emissiveColor,
  emissiveIntensity,
  opacity,
}: {
  url: string;
  clipPlanes: THREE.Plane[];
  emissiveColor: THREE.Color;
  emissiveIntensity: number;
  opacity: number;
}) {
  const gltf = useGLTF(url);

  // useGLTF caches and shares ONE scene graph across every consumer, so the
  // scene is cloned before its materials are touched — mutating the cached
  // original would leak this Brain's state colour into any other view that
  // loads the same asset. Same rule GltfSuitModel.tsx already follows.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.Material;
      const material = source.clone() as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.6;
      material.clippingPlanes = clipPlanes;
      material.clipShadows = true;
      if (material.emissive) {
        material.emissive.copy(emissiveColor);
        material.emissiveIntensity = emissiveIntensity;
      }
      mesh.material = material;
    });
  }, [scene, clipPlanes, emissiveColor, emissiveIntensity, opacity]);

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
