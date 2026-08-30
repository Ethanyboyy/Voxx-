"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { approach, DURATION } from "@/lib/3d/animation";
import type { Visibility } from "@/lib/3d/interaction";

/**
 * Wraps any 3D content in the shared interaction behaviour: hover, tap,
 * selection highlight, dimming, isolation and exploded-view offset.
 *
 * Two decisions are deliberate and worth stating, because both were arrived at
 * by getting them wrong first:
 *
 * 1. **Highlighting never swaps the material.** It animates emissive intensity
 *    and an outline scale on the object's OWN material. Swapping materials to
 *    highlight loses whatever the surface actually is — a highlighted fabric
 *    panel that turns into flat plastic tells the user less than no highlight.
 * 2. **Touch is a first-class path, not a hover fallback.** A phone has no
 *    hover, so anything that only appears on hover is invisible on mobile. The
 *    tap handler selects directly, and `stopPropagation` keeps a tap on a small
 *    part from also selecting the large part behind it.
 */

export interface SelectableProps {
  id: string;
  visibility?: Visibility;
  selected?: boolean;
  hovered?: boolean;
  /** Exploded-view offset in local space. */
  offset?: [number, number, number];
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** Registry the camera rig resolves ids against. */
  registry?: React.MutableRefObject<Map<string, THREE.Object3D>>;
  /** Accent used for the selection glow. */
  accent?: string;
  children: React.ReactNode;
  reducedMotion?: boolean;
}

export function Selectable({
  id,
  visibility = "visible",
  selected = false,
  hovered = false,
  offset = [0, 0, 0],
  onSelect,
  onHover,
  registry,
  accent = "#a855f7",
  children,
  reducedMotion = false,
}: SelectableProps) {
  const group = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3());
  const desired = useMemo(() => new THREE.Vector3(...offset), [offset]);

  // Register/unregister so FocusRig can find this object by id.
  useEffect(() => {
    const node = group.current;
    if (!registry || !node) return;
    // Capture the Map itself, not `registry.current` at cleanup time: if the
    // parent ever swaps registries, unregistering from the NEW map would leave
    // a dead object in the old one for the camera rig to frame.
    const map = registry.current;
    map.set(id, node);
    return () => {
      map.delete(id);
    };
  }, [id, registry]);

  const targetOpacity = visibility === "dimmed" ? 0.18 : 1;
  const emissiveTarget = selected ? 0.9 : hovered ? 0.4 : 0;

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    const k = reducedMotion ? 1 : approach(1 / DURATION.quick, delta);
    current.current.lerp(desired, k);
    node.position.copy(current.current);

    // Walk the subtree once per frame and ease material state. Cheap at this
    // scale, and it keeps highlight logic out of every leaf component.
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!material || Array.isArray(material)) return;

      if (material.transparent || targetOpacity < 1) {
        material.transparent = true;
        material.opacity += (targetOpacity - material.opacity) * k;
        material.depthWrite = material.opacity > 0.9;
      }
      if ("emissiveIntensity" in material) {
        material.emissiveIntensity += (emissiveTarget - material.emissiveIntensity) * k;
        if (emissiveTarget > 0 && material.emissive) material.emissive.set(accent);
      }
    });
  });

  if (visibility === "hidden") return null;

  const interactive = visibility !== "dimmed";

  return (
    <group
      ref={group}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        onSelect?.(id);
      }}
      onPointerOver={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        onHover?.(id);
      }}
      onPointerOut={() => onHover?.(null)}
    >
      {children}
    </group>
  );
}
