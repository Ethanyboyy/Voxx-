"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CANONICAL_BODY_HEIGHT } from "@/components/lab/three/canonicalBody";
import { createChamferedSlab } from "@/components/lab/three/panelGeometry";

const H = CANONICAL_BODY_HEIGHT;

/**
 * The wrist web system, as separately selectable subcomponents.
 *
 * This exists because the drill-down has to bottom out somewhere real. The
 * interaction the Lab is meant to support is suit → arm → web-shooter →
 * cartridge, and until now the third and fourth levels had nothing to select:
 * the forearm carried a single anonymous shell and the device the whole
 * subsystem is named after was not modelled at all.
 *
 * Each part below is a distinct mesh with its own id, so the camera can frame
 * it and the Laboratory can attach its own cost, mass and provenance to it,
 * rather than the whole assembly resolving to one undifferentiated "forearm".
 */

export type WristPartId =
  | "wristHousing"
  | "wristMechanism"
  | "wristCartridge"
  | "wristNozzle"
  | "wristTrigger";

export interface WristSystemProps {
  /** Which arm this instance belongs to; ids are suffixed L/R by the caller. */
  side: "L" | "R";
  /** Wrist joint and hand joint, in world space — the device sits between. */
  wrist: THREE.Vector3;
  hand: THREE.Vector3;
  materials: Record<string, THREE.Material>;
  accent: string;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** Shared highlight materials, allocated once by the parent. */
  selectionMaterial: THREE.Material;
  hoverMaterial: THREE.Material;
  /** Same registry the armour uses — see SuitArmorProps.registry. */
  registry?: React.MutableRefObject<Map<string, THREE.Object3D>>;
}

export function WristSystem({
  side,
  wrist,
  hand,
  materials,
  accent,
  selectedId = null,
  hoveredId = null,
  onSelect,
  onHover,
  selectionMaterial,
  hoverMaterial,
  registry,
}: WristSystemProps) {
  // Orientation: local Z runs down the forearm toward the hand, local Y is the
  // body's front, matching the convention the armour shells already use.
  const quaternion = useMemo(() => {
    const dir = hand.clone().sub(wrist).normalize();
    const front = new THREE.Vector3(0, 0, 1);
    const ref = Math.abs(dir.dot(front)) > 0.9 ? new THREE.Vector3(0, 1, 0) : front;
    const x = ref.clone().cross(dir).normalize();
    const y = dir.clone().cross(x).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, dir));
  }, [wrist, hand]);

  const position = useMemo(() => wrist.clone().lerp(hand, 0.28), [wrist, hand]);

  const geometries = useMemo(
    () => ({
      housing: createChamferedSlab(0.036 * H, 0.026 * H, 0.05 * H, 0.004 * H),
      mechanism: createChamferedSlab(0.024 * H, 0.016 * H, 0.03 * H, 0.002 * H),
      trigger: createChamferedSlab(0.01 * H, 0.008 * H, 0.014 * H, 0.0015 * H),
    }),
    []
  );

  useEffect(() => {
    const list = Object.values(geometries);
    return () => {
      for (const g of list) g.dispose();
    };
  }, [geometries]);

  const emissive = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.9,
        metalness: 0.4,
        roughness: 0.3,
        toneMapped: false,
      }),
    [accent]
  );
  useEffect(() => () => emissive.dispose(), [emissive]);

  const plate = materials.ARMOR ?? materials.FABRIC;
  const trim = materials.TRIM ?? plate;

  const id = (part: WristPartId) => `${part}${side}`;
  const highlight = (part: WristPartId) => {
    if (selectedId === id(part)) return selectionMaterial;
    if (hoveredId === id(part)) return hoverMaterial;
    return null;
  };

  /** Every part gets the same handlers; stopPropagation keeps a click on the
   *  nozzle from also selecting the housing behind it. */
  const register = (part: WristPartId) => (o: THREE.Object3D | null) => {
    if (!registry) return;
    if (o) registry.current.set(id(part), o);
    else registry.current.delete(id(part));
  };

  const handlers = (part: WristPartId) => ({
    onPointerDown: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect?.(id(part));
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHover?.(id(part));
    },
    onPointerOut: () => onHover?.(null),
  });

  const part = (p: WristPartId, node: React.ReactNode, overlay: React.ReactNode) => (
    <>
      {node}
      {highlight(p) ? overlay : null}
    </>
  );

  return (
    <group position={position.toArray()} quaternion={quaternion}>
      {/* Housing — the chassis everything else mounts into. */}
      {part(
        "wristHousing",
        <mesh ref={register("wristHousing")} geometry={geometries.housing} material={plate} castShadow {...handlers("wristHousing")} />,
        <mesh geometry={geometries.housing} material={selectionMaterial} scale={1.06} raycast={() => null} />
      )}

      {/* Mechanism — sits proud of the housing on the outboard face. */}
      {part(
        "wristMechanism",
        <mesh
          ref={register("wristMechanism")}
          geometry={geometries.mechanism}
          material={trim}
          position={[0, 0.02 * H, -0.004 * H]}
          castShadow
          {...handlers("wristMechanism")}
        />,
        <mesh
          geometry={geometries.mechanism}
          material={highlight("wristMechanism")!}
          position={[0, 0.02 * H, -0.004 * H]}
          scale={1.1}
          raycast={() => null}
        />
      )}

      {/* Cartridge — a cylinder seated across the housing, the consumable. */}
      {part(
        "wristCartridge",
        <mesh
          ref={register("wristCartridge")}
          material={trim}
          position={[0, 0.006 * H, -0.019 * H]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
          {...handlers("wristCartridge")}
        >
          <cylinderGeometry args={[0.008 * H, 0.008 * H, 0.03 * H, 20]} />
        </mesh>,
        <mesh position={[0, 0.006 * H, -0.019 * H]} rotation={[0, 0, Math.PI / 2]} material={highlight("wristCartridge")!} scale={1.12} raycast={() => null}>
          <cylinderGeometry args={[0.008 * H, 0.008 * H, 0.03 * H, 20]} />
        </mesh>
      )}

      {/* Nozzle — the emitter, pointing down the hand. Lit, because it is the
          one part of this assembly that is actually energised. */}
      {part(
        "wristNozzle",
        <mesh ref={register("wristNozzle")} material={emissive} position={[0, 0.008 * H, 0.028 * H]} rotation={[Math.PI / 2, 0, 0]} {...handlers("wristNozzle")}>
          <cylinderGeometry args={[0.0045 * H, 0.006 * H, 0.012 * H, 16]} />
        </mesh>,
        <mesh position={[0, 0.008 * H, 0.028 * H]} rotation={[Math.PI / 2, 0, 0]} material={highlight("wristNozzle")!} scale={1.3} raycast={() => null}>
          <cylinderGeometry args={[0.0045 * H, 0.006 * H, 0.012 * H, 16]} />
        </mesh>
      )}

      {/* Trigger pad — palm side, where a finger would actually reach it. */}
      {part(
        "wristTrigger",
        <mesh
          ref={register("wristTrigger")}
          geometry={geometries.trigger}
          material={trim}
          position={[0, -0.014 * H, 0.014 * H]}
          castShadow
          {...handlers("wristTrigger")}
        />,
        <mesh geometry={geometries.trigger} material={highlight("wristTrigger")!} position={[0, -0.014 * H, 0.014 * H]} scale={1.2} raycast={() => null} />
      )}
    </group>
  );
}
