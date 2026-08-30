"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { Materialize } from "@/components/three/Materialize";
import { Selectable } from "@/components/three/Selectable";
import { componentForMesh, resolveLod, type AssetDefinition } from "@/lib/3d/assetRegistry";
import { buildTree, visibilityOf, type AssetNode, type InteractionState } from "@/lib/3d/interaction";
import type { QualityTier } from "@/lib/3d/quality";

/**
 * Renders a registered external asset — the one component an imported hero GLB
 * needs in order to become a first-class part of VOX.
 *
 * It takes an `AssetDefinition`, not a URL. That is the entire point of the
 * contract: the UI never names a file, so replacing a placeholder with a
 * commissioned or generated asset is a data change, not a code change. LOD
 * selection, component naming, interactivity and provenance all come from the
 * manifest that shipped alongside the file.
 *
 * What it does NOT do is guess. If the manifest names a mesh the GLB does not
 * contain, that part is simply not interactive and `onMissingMeshes` reports
 * it — the alternative, matching by prefix or index, produces an inspector that
 * confidently labels the wrong geometry.
 */

export interface AssetModelProps {
  asset: AssetDefinition;
  tier: QualityTier;
  /** Normalises the asset to this height in world units. Omit to keep authored scale. */
  targetHeight?: number;
  /** Y coordinate the asset's lowest point sits at, when normalising. */
  groundY?: number;
  interaction?: InteractionState;
  nodes?: AssetNode[];
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  registry?: React.MutableRefObject<Map<string, THREE.Object3D>>;
  reducedMotion?: boolean;
  /** Reports manifest mesh names absent from the file. */
  onMissingMeshes?: (names: string[]) => void;
}

interface FitTransform {
  scale: number;
  position: [number, number, number];
}

/**
 * Where to put the asset so it fits the stage, as a transform for a wrapper
 * group rather than a mutation of the loaded root.
 *
 * The distinction matters: the claimed meshes below get lifted out of the
 * asset's own hierarchy into interaction groups, and if the fit lived on the
 * root they would leave it behind and render at authored scale — a real class
 * of bug, and an invisible one until someone imports an asset authored in
 * centimetres.
 */
function fitTransform(scene: THREE.Object3D, targetHeight?: number, groundY = 0): FitTransform {
  const identity: FitTransform = { scale: 1, position: [0, 0, 0] };
  if (!targetHeight) return identity;

  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return identity;
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return identity;

  const scale = targetHeight / size.y;
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  return {
    scale,
    position: [-centre.x * scale, groundY - box.min.y * scale, -centre.z * scale],
  };
}

export function AssetModel({
  asset,
  tier,
  targetHeight,
  groundY = 0,
  interaction,
  nodes,
  onSelect,
  onHover,
  registry,
  reducedMotion = false,
  onMissingMeshes,
}: AssetModelProps) {
  const lod = resolveLod(asset, tier);
  // Hooks cannot be conditional and useGLTF suspends. An asset with no
  // resolvable LOD is impossible by construction — the schema requires at least
  // one and resolveLod falls back in both directions — so this is enforced
  // upstream rather than hoped for.
  const url = lod?.url ?? asset.lods[0].url;
  const gltf = useGLTF(url);

  const { scene, parts, transform } = useMemo(() => {
    // useGLTF caches ONE scene graph per url and shares it across every mount;
    // transforming it directly corrupts every other instance.
    const cloned = SkeletonUtils.clone(gltf.scene);
    const transform = fitTransform(cloned, targetHeight, groundY);

    // The clone's root is at identity, so every descendant's matrixWorld is
    // already its transform relative to the asset — which is exactly what a
    // mesh needs baked into it before being reparented out of the hierarchy.
    cloned.updateMatrixWorld(true);

    const present = new Set<string>();
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) present.add(obj.name);
    });
    const missing = asset.components.flatMap((c) => c.meshNames).filter((name) => !present.has(name));
    if (missing.length > 0) onMissingMeshes?.(missing);

    // Collect first, mutate second: reparenting during a traverse mutates the
    // very child arrays being walked.
    const claimed: Array<{ id: string; mesh: THREE.Mesh }> = [];
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const component = componentForMesh(asset, mesh.name);
      if (!component || !component.interactive) return;
      claimed.push({ id: component.id, mesh });
    });

    const parts = new Map<string, THREE.Object3D[]>();
    for (const { id, mesh } of claimed) {
      mesh.matrix.copy(mesh.matrixWorld);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.removeFromParent();
      const list = parts.get(id) ?? [];
      list.push(mesh);
      parts.set(id, list);
    }

    // Meshes no component claims stay in the scene and render — they are part
    // of the asset, just not separately inspectable.
    return { scene: cloned, parts, transform };
    // onMissingMeshes is a reporting callback; re-cloning because its identity
    // changed would throw away GPU resources for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene, asset, targetHeight, groundY]);

  // Visibility is a question about the hierarchy ("is this inside what's
  // focused?"), so the flat node list has to be indexed before it can answer.
  const tree = useMemo(() => buildTree(nodes ?? []), [nodes]);

  return (
    <Materialize trigger={`${asset.assetId}:${url}`} reducedMotion={reducedMotion}>
      <group scale={transform.scale} position={transform.position}>
        <primitive object={scene} />

        {/* Interaction wrappers hold the asset's REAL meshes, so selecting a
            part highlights the geometry from the file rather than a stand-in
            box drawn near it. */}
        {[...parts.entries()].map(([id, objects]) => (
          <Selectable
            key={id}
            id={id}
            registry={registry}
            visibility={interaction ? visibilityOf(tree, interaction, id) : "visible"}
            selected={interaction?.selectedId === id}
            hovered={interaction?.hoverId === id}
            onSelect={onSelect}
            onHover={onHover}
            reducedMotion={reducedMotion}
          >
            {objects.map((object, i) => (
              <primitive key={i} object={object} />
            ))}
          </Selectable>
        ))}
      </group>
    </Materialize>
  );
}
