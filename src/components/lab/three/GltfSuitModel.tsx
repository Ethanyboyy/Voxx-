"use client";

import { Component, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { createEmblemTexture, type ArmorLevel, type MaskLensStyle, type MaterialLanguage, type PatternStyle, type Silhouette } from "@/components/lab/three/suitDesign";
import { resolveSuitBuild } from "@/components/lab/three/suitConfig";
import { SuitArmor, buildSurfaceMaterials } from "@/components/lab/three/SuitArmor";

import { CANONICAL_BODY_HEIGHT, CANONICAL_FEET_Y } from "@/components/lab/three/canonicalBody";

// Re-exported so existing importers of this module keep working.
export { CANONICAL_BODY_HEIGHT, CANONICAL_FEET_Y };

/** Rough, proportion-based estimate of chest height above the feet for a
 * body normalized to CANONICAL_BODY_HEIGHT (~74% of standing height, an
 * ordinary sternum/nipple-line placement) — used only to anchor the emblem
 * decal in world space, independent of this asset's own (untested, real but
 * unknown-layout) UVs. Not a per-vertex measurement — a real 3D asset varies
 * a few centimeters here in reality too, and the decal is small enough
 * that this doesn't visibly matter. */
const ESTIMATED_CHEST_Y = CANONICAL_FEET_Y + CANONICAL_BODY_HEIGHT * 0.74;
const ESTIMATED_HALF_DEPTH = 0.18;

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
 * CANONICAL_FEET_Y, and scales to CANONICAL_BODY_HEIGHT. Also collects every
 * real (non-hidden) Mesh it produces, so the caller can apply the actual
 * suit material to them without re-traversing or re-guessing which nodes
 * are real geometry vs. hidden/skinned originals.
 */
function normalizeToCanonicalBody(scene: THREE.Object3D): {
  scene: THREE.Object3D;
  suitMeshes: THREE.Mesh[];
  anchors: Map<string, THREE.Vector3>;
} {
  let hasZUpRoot = false;
  scene.traverse((obj) => {
    if (obj.name === "Z_UP") hasZUpRoot = true;
  });

  // Measure ONCE, at identity, before any rotation/scale/skinning mutation —
  // see CESIUM_MAN_CORRECTIVE_ROTATION's doc comment for why re-measuring
  // with Box3 AFTER rotating (or after the plain-mesh swap below) is
  // unreliable on a SkeletonUtils-cloned hierarchy. Every asset's height
  // axis is derived from this one trusted measurement.
  const box0 = new THREE.Box3().setFromObject(scene);
  const center0 = new THREE.Vector3();
  box0.getCenter(center0);

  let trueHeight: number;
  let positioningCenter: THREE.Vector3;
  if (hasZUpRoot) {
    // CesiumMan-specific: height lands on this scene's local X axis once its
    // own loader-baked node matrices are composed (see corrective rotation's
    // own doc comment) — not the Y axis a standard Y-up glTF would use.
    trueHeight = box0.max.x - box0.min.x;
    scene.quaternion.copy(CESIUM_MAN_CORRECTIVE_ROTATION);
    positioningCenter = center0.clone().applyQuaternion(CESIUM_MAN_CORRECTIVE_ROTATION);
  } else {
    // Standard Y-up glTF (e.g. Xbot): no corrective rotation needed, height
    // is already on Y.
    trueHeight = box0.max.y - box0.min.y;
    positioningCenter = center0;
  }

  if (trueHeight > 0) {
    const scale = CANONICAL_BODY_HEIGHT / trueHeight;
    scene.scale.setScalar(scale);
    scene.position.set(
      -positioningCenter.x * scale,
      CANONICAL_FEET_Y - (positioningCenter.y - trueHeight / 2) * scale,
      -positioningCenter.z * scale,
    );
  }

  // Real joint positions, read from the asset's own skeleton after
  // normalization. Armour mounted to a MEASURED shoulder sits on the
  // shoulder for any rigged body; armour mounted to a guessed coordinate
  // floats next to it the moment the pose differs from the guess — which is
  // exactly what happened when these were hardcoded against an imagined
  // arms-down pose and the asset turned out to be in a T-pose.
  const anchors = new Map<string, THREE.Vector3>();
  scene.updateWorldMatrix(true, true);
  scene.traverse((obj) => {
    const match = /^mixamorig:?(.+)$/.exec(obj.name);
    if (!match) return;
    anchors.set(match[1], obj.getWorldPosition(new THREE.Vector3()));
  });

  const suitMeshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.frustumCulled = false;
      const mesh = obj as THREE.Mesh;
      // SKINNING_UNRELIABLE: every SkeletonUtils-cloned SkinnedMesh tried in
      // this pipeline so far (CesiumMan, then Xbot) either renders a badly
      // distorted live-skinned pose or fails to render at all, despite its
      // own rest-pose geometry.boundingBox being correct — confirmed by
      // rendering each and looking, not assumed. This pipeline doesn't
      // currently drive any animation off these clips anyway, so every
      // SkinnedMesh gets swapped for a plain Mesh sharing the same
      // (rest-pose) geometry instead of paying for broken live GPU skinning.
      // If a future suit genuinely needs live animation, that asset needs
      // its own investigation into why skinning fails here, not a silent
      // opt-out of this swap.
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const plain = new THREE.Mesh(mesh.geometry, mesh.material);
        plain.frustumCulled = false;
        mesh.parent?.add(plain);
        mesh.visible = false;
        suitMeshes.push(plain);
      } else {
        suitMeshes.push(mesh);
      }
    }
  });

  return { scene, suitMeshes, anchors };
}

export interface GltfSuitModelProps {
  url: string;
  colorPrimary: string;
  colorSecondary: string;
  materialLanguage: MaterialLanguage;
  /** Accepted for interface parity with SuitRigProps/design records but not
   * currently used here — see suitMaterial's doc comment for why the
   * tiled UV-based pattern textures this would drive aren't applied to a
   * GLB body with an unknown real UV layout. */
  patternStyle: PatternStyle;
  /** Same semantics as SuitRig's xray: more transparent base material,
   * boosted emissive so the circuit pattern still reads through it. */
  xray?: boolean;
  /** Decorative rim/energy glow — the "hologram" layer per the visual
   * directive's material hierarchy (geometry/anatomy/materials come first;
   * this must ENHANCE the real mesh, never stand in for it). Matches
   * HolographicSuitCanvas's showEffects toggle so the raw suit can be
   * inspected with this off. */
  showEffects?: boolean;
  /** Visual QA mode: neutral clay material (no pattern/emissive map), no
   * rim glow, no emblem decals — pure geometry + studio lighting, so the
   * anatomy itself can be judged with every material and holographic layer
   * actually absent, not just visually deemphasized. */
  rawGeometry?: boolean;
  /** Build inputs — what the suit is actually made of. Drive the real armour
   *  geometry and the surface material set (see suitConfig.ts). */
  archetype?: string;
  silhouette?: Silhouette;
  armorLevel?: ArmorLevel;
  maskLensStyle?: MaskLensStyle;
  /** Hides hard components so the body underneath can be inspected. */
  hideArmor?: boolean;
  explodeAmount?: number;
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
 *
 * The loaded asset (CesiumMan today) is a bare human body, not a suit — it
 * ships its own placeholder diffuse texture with no relationship to this
 * suit's actual design parameters. This replaces that placeholder with a
 * real PBR material driven by the suit's own colors/material language (see
 * suitMaterial's doc comment for why it's a flat base + emissive tint
 * rather than SuitRig's tiled UV pattern textures), a position-anchored
 * spider emblem decal, and a rim/energy glow layer — so a GLB-backed suit
 * reads as an actual manufactured second-skin garment over real anatomy,
 * not a bare mannequin wearing its source asset's placeholder texture.
 */
export function GltfSuitModel({
  url,
  colorPrimary,
  colorSecondary,
  materialLanguage,
  xray = false,
  showEffects = true,
  rawGeometry = false,
  archetype = "Utility",
  silhouette = "ATHLETIC",
  armorLevel = "LIGHT",
  maskLensStyle = "ANGULAR",
  hideArmor = false,
  explodeAmount = 0,
}: GltfSuitModelProps) {
  const gltf = useGLTF(url);
  const emblemTexture = useMemo(() => createEmblemTexture(colorPrimary), [colorPrimary]);

  // Builds the clone, normalizes it, AND applies the real suit material —
  // all inside the SAME memo that creates the mesh objects in the first
  // place, the same pattern normalizeToCanonicalBody itself already uses
  // for the scale/rotation/skinning mutations above. Mutating a mesh's
  // .material after it has already escaped as a separately-memoized value
  // (e.g. in a later useEffect keyed on this memo's own output) is exactly
  // the pattern React's hook-immutability rule (and the real bugs it's
  // guarding against — a memoized value silently mutated out from under
  // whatever else may hold the same reference) exists to catch.
  //
  // The material itself is deliberately NOT SuitRig's tiled map/emissiveMap
  // pattern textures (createPatternTexture / createEmissiveMaskTexture):
  // those were tuned against the procedural rig's own known per-segment UV
  // layout (small boxes/cylinders at a fixed scale), and applying the same
  // repeat count to CesiumMan's real but untested full-body UV atlas
  // produced an overwhelming, disproportionate wash of glowing lines on
  // thin limb geometry — confirmed by rendering it and looking, not
  // assumed. A flat base color + a low, uniform emissive tint is
  // UV-layout-independent and reads as a real technical garment regardless
  // of how this (or any future) asset's UVs are laid out; the
  // position-anchored emblem decal below carries the pattern-level visual
  // interest instead. rawGeometry strips this to plain clay with no color
  // identity or emissive at all — the §21/§24 QA claim is that the
  // GEOMETRY, not this material work, has to read as a real human body.
  // Pure and deterministic — the same suit record always yields the same
  // build, so a design can be compared and reasoned about.
  const build = useMemo(
    () => resolveSuitBuild({ archetype, silhouette, materialLanguage, armorLevel }),
    [archetype, silhouette, materialLanguage, armorLevel]
  );

  const { scene, rimMeshes, surfaces, anchors } = useMemo(() => {
    const result = normalizeToCanonicalBody(SkeletonUtils.clone(gltf.scene));
    // The body wears the build's UNDERLAYER surface — the second skin the
    // hard components are mounted onto. It is a genuinely different material
    // from the plates (see SURFACE_SPECS): woven where the suit is woven,
    // rubbery where it is elastomer, and never the same flat response the
    // plates have, which is what made the old single-material suit read as
    // one moulded object instead of a garment with construction.
    const surfaces = buildSurfaceMaterials(build, colorPrimary, colorSecondary, {
      xray,
      neutral: rawGeometry,
    });
    const material = surfaces[build.underlayer] ?? surfaces.FABRIC;
    const rim = new THREE.MeshBasicMaterial({ color: colorPrimary, transparent: true, opacity: xray ? 0.16 : 0.07, side: THREE.BackSide, toneMapped: false, depthWrite: false });
    const rimClones: THREE.Mesh[] = [];
    for (const mesh of result.suitMeshes) {
      mesh.material = material;
      const clone = mesh.clone();
      clone.material = rim;
      rimClones.push(clone);
    }
    return { ...result, rimMeshes: rimClones, surfaces };
  }, [gltf.scene, build, colorPrimary, colorSecondary, xray, rawGeometry]);

  return (
    <>
      <primitive object={scene} />

      {/* The suit's hard components as real geometry. This is the difference
          between a body wearing a suit and a body tinted the colour of one:
          plates stand off the mesh, catch the key light on their own edges,
          and cast shadows onto the surface below. rawGeometry keeps them —
          they ARE geometry — but strips their colour identity to clay. */}
      <SuitArmor
        build={build}
        materials={surfaces}
        anchors={anchors}
        maskLensStyle={maskLensStyle}
        accent={rawGeometry ? "#8b8794" : colorPrimary}
        hidden={hideArmor}
        explodeAmount={explodeAmount}
      />
      {/* Rim/energy glow — a scaled BackSide shell per real mesh, same
          proven technique BrainMesh.tsx uses for its holographic edge:
          additive-reading, unlit, and purely additive to the material
          already on the mesh underneath — removing it (showEffects=false)
          must leave a still-legible, still-textured suit, never a blank
          silhouette. */}
      {/* A much smaller offset than BrainMesh's own 1.015/SuitRig-scale rim
          shells: CesiumMan's real limb radii are far thinner than either of
          those, so the same relative scale-up reads as an oversized glow
          halo, not a thin edge highlight — confirmed by rendering it. */}
      {showEffects ? rimMeshes.map((mesh, i) => <primitive key={i} object={mesh} scale={1.004} />) : null}
      {/* Emblem — the suit's real identity mark, front and back, anchored to
          an estimated chest position in world space rather than this
          asset's own (real, but untested-layout) UVs — see
          ESTIMATED_CHEST_Y's doc comment. Not part of raw geometry: it's a
          decal, not the mesh. */}
      {!rawGeometry ? (
        <>
          <mesh position={[0, ESTIMATED_CHEST_Y + 0.04, ESTIMATED_HALF_DEPTH + 0.055]}>
            <planeGeometry args={[0.115, 0.115]} />
            <meshBasicMaterial map={emblemTexture} transparent opacity={xray ? 0.5 : 0.95} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, ESTIMATED_CHEST_Y, -ESTIMATED_HALF_DEPTH]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.09, 0.09]} />
            <meshBasicMaterial map={emblemTexture} transparent opacity={xray ? 0.4 : 0.75} toneMapped={false} depthWrite={false} />
          </mesh>
        </>
      ) : null}
    </>
  );
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
