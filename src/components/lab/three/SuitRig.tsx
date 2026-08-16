"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import {
  createPatternTexture,
  MATERIAL_SPECS,
  SILHOUETTE_PROPORTIONS,
  type ArmorLevel,
  type MaskLensStyle,
  type MaterialLanguage,
  type PatternStyle,
  type Silhouette,
} from "@/components/lab/three/suitDesign";

export type SuitLayer = "outer" | "structural" | "thermal" | "electronics" | "sensors" | "mask" | "gloves" | "boots";

export interface SuitRigProps {
  colorPrimary: string;
  colorSecondary: string;
  silhouette: Silhouette;
  materialLanguage: MaterialLanguage;
  patternStyle: PatternStyle;
  armorLevel: ArmorLevel;
  maskLensStyle: MaskLensStyle;
  visibleLayers: Set<SuitLayer>;
  xray: boolean;
  explodeAmount: number; // 0-1
}

interface PartDef {
  name: string;
  layer: SuitLayer;
  /** Joint position (top of this segment) — the mesh itself hangs below this. */
  joint: [number, number, number];
  rotationZ?: number;
  explodeDir: [number, number, number];
  explodeDistance: number;
}

/** Smoothly animates a group toward `explodeAmount * explodeDir * distance`
 * away from its rest joint position — the "exploded view" interaction. */
function ExplodingGroup({
  def,
  explodeAmount,
  children,
}: {
  def: PartDef;
  explodeAmount: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(() => {
    const [rx, ry, rz] = def.joint;
    const [dx, dy, dz] = def.explodeDir;
    return new THREE.Vector3(
      rx + dx * def.explodeDistance * explodeAmount,
      ry + dy * def.explodeDistance * explodeAmount,
      rz + dz * def.explodeDistance * explodeAmount
    );
  }, [def, explodeAmount]);

  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.lerp(target, 0.15);
  });

  return (
    <group ref={ref} position={def.joint} rotation={[0, 0, def.rotationZ ?? 0]}>
      {children}
    </group>
  );
}

/** A limb segment hanging from its parent group's origin (the joint) —
 * offset down by half its own length so the capsule's TOP meets the joint
 * rather than being centered on it. */
function LimbSegment({ radius, length, materialProps }: { radius: number; length: number; materialProps: Record<string, unknown> }) {
  return (
    <mesh castShadow position={[0, -length / 2, 0]}>
      <capsuleGeometry args={[radius, length * 0.55, 4, 8]} />
      <meshStandardMaterial {...materialProps} />
    </mesh>
  );
}

export function SuitRig({
  colorPrimary,
  colorSecondary,
  silhouette,
  materialLanguage,
  patternStyle,
  armorLevel,
  maskLensStyle,
  visibleLayers,
  xray,
  explodeAmount,
}: SuitRigProps) {
  const p = SILHOUETTE_PROPORTIONS[silhouette];
  const mat = MATERIAL_SPECS[materialLanguage];
  const patternTexture = useMemo(
    () => createPatternTexture(patternStyle, colorPrimary, colorSecondary),
    [patternStyle, colorPrimary, colorSecondary]
  );

  const show = (l: SuitLayer) => visibleLayers.has(l);
  const outerOpacity = xray ? 0.14 : 1;

  const outerMaterialProps = {
    color: colorPrimary,
    metalness: mat.metalness,
    roughness: mat.roughness,
    emissive: colorPrimary,
    emissiveIntensity: mat.emissiveIntensity * (xray ? 0.4 : 1),
    map: patternTexture,
    transparent: true,
    opacity: outerOpacity,
  };

  const L = 0.36; // limb segment length
  const shoulderY = p.torsoHeight / 2 - 0.06;
  const hipY = -p.torsoHeight / 2;
  const hipX = p.torsoWidth / 2.6;
  const shoulderX = p.shoulderWidth / 2;

  const armParts: PartDef[] = [
    { name: "upperArmL", layer: "outer", joint: [-shoulderX, shoulderY, 0], rotationZ: 0.12, explodeDir: [-1, 0.15, 0], explodeDistance: 0.5 },
    { name: "lowerArmL", layer: "outer", joint: [-shoulderX - L * 0.12, shoulderY - L, 0], rotationZ: 0.05, explodeDir: [-1, -0.2, 0], explodeDistance: 0.65 },
    { name: "handL", layer: "gloves", joint: [-shoulderX - L * 0.2, shoulderY - L * 2 - 0.02, 0], explodeDir: [-1, -0.4, 0], explodeDistance: 0.8 },
    { name: "upperArmR", layer: "outer", joint: [shoulderX, shoulderY, 0], rotationZ: -0.12, explodeDir: [1, 0.15, 0], explodeDistance: 0.5 },
    { name: "lowerArmR", layer: "outer", joint: [shoulderX + L * 0.12, shoulderY - L, 0], rotationZ: -0.05, explodeDir: [1, -0.2, 0], explodeDistance: 0.65 },
    { name: "handR", layer: "gloves", joint: [shoulderX + L * 0.2, shoulderY - L * 2 - 0.02, 0], explodeDir: [1, -0.4, 0], explodeDistance: 0.8 },
  ];

  const legParts: PartDef[] = [
    { name: "upperLegL", layer: "outer", joint: [-hipX, hipY, 0], explodeDir: [-0.4, -1, 0], explodeDistance: 0.4 },
    { name: "lowerLegL", layer: "outer", joint: [-hipX, hipY - L, 0], explodeDir: [-0.5, -1, 0], explodeDistance: 0.6 },
    { name: "footL", layer: "boots", joint: [-hipX, hipY - L * 2 - 0.02, 0.05], explodeDir: [-0.5, -1, 0.3], explodeDistance: 0.85 },
    { name: "upperLegR", layer: "outer", joint: [hipX, hipY, 0], explodeDir: [0.4, -1, 0], explodeDistance: 0.4 },
    { name: "lowerLegR", layer: "outer", joint: [hipX, hipY - L, 0], explodeDir: [0.5, -1, 0], explodeDistance: 0.6 },
    { name: "footR", layer: "boots", joint: [hipX, hipY - L * 2 - 0.02, 0.05], explodeDir: [0.5, -1, 0.3], explodeDistance: 0.85 },
  ];

  const head: PartDef = {
    name: "head",
    layer: "mask",
    joint: [0, shoulderY + 0.09 + 0.19 * p.headScale, 0],
    explodeDir: [0, 1, 0],
    explodeDistance: 0.55,
  };
  const chest: PartDef = { name: "chest", layer: "structural", joint: [0, 0.03, p.torsoDepth / 2 + 0.01], explodeDir: [0, 0, 1], explodeDistance: 0.4 };

  const { lensGeometry, lensRotation } = useMemo(() => {
    switch (maskLensStyle) {
      case "NARROW":
        return { lensGeometry: <capsuleGeometry args={[0.038, 0.075, 4, 8]} />, lensRotation: [0, 0, Math.PI / 2] as [number, number, number] };
      case "WIDE":
        return { lensGeometry: <sphereGeometry args={[0.085, 16, 12]} />, lensRotation: [0, 0, 0] as [number, number, number] };
      case "ANGULAR":
        return { lensGeometry: <coneGeometry args={[0.075, 0.13, 4]} />, lensRotation: [Math.PI / 2, Math.PI / 4, 0] as [number, number, number] };
      case "ROUND":
        return { lensGeometry: <sphereGeometry args={[0.07, 20, 16]} />, lensRotation: [0, 0, 0] as [number, number, number] };
      case "MECHANICAL":
        return { lensGeometry: <cylinderGeometry args={[0.065, 0.065, 0.05, 6]} />, lensRotation: [Math.PI / 2, 0, 0] as [number, number, number] };
    }
  }, [maskLensStyle]);

  return (
    <group>
      {/* Torso (outer shell) — rounded for a smooth, non-blocky silhouette */}
      {show("outer") ? (
        <RoundedBox
          castShadow
          position={[0, 0.03, 0]}
          args={[p.torsoWidth, p.torsoHeight, p.torsoDepth]}
          radius={Math.min(0.09, p.torsoDepth * 0.35)}
          smoothness={4}
        >
          <meshStandardMaterial {...outerMaterialProps} />
        </RoundedBox>
      ) : null}

      {/* Structural layer — internal rib frame, revealed in x-ray */}
      {show("structural") && (xray || armorLevel !== "NONE") ? (
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[p.torsoWidth * 0.72, p.torsoHeight * 0.82, p.torsoDepth * 0.5]} />
          <meshStandardMaterial
            color={colorSecondary}
            metalness={0.7}
            roughness={0.25}
            emissive={colorPrimary}
            emissiveIntensity={xray ? 0.5 : 0.1}
            wireframe={xray}
            transparent
            opacity={xray ? 0.9 : 0.5}
          />
        </mesh>
      ) : null}

      {/* Thermal layer overlay */}
      {show("thermal") && xray ? (
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[p.torsoWidth * 1.08, p.torsoHeight * 1.05, p.torsoDepth * 1.15]} />
          <meshStandardMaterial color="#fb923c" transparent opacity={0.16} emissive="#fb923c" emissiveIntensity={0.4} />
        </mesh>
      ) : null}

      {/* Electronics — glowing spine line */}
      {show("electronics") ? (
        <mesh position={[0, 0.03, p.torsoDepth / 2 + 0.005]}>
          <boxGeometry args={[0.03, p.torsoHeight * 0.85, 0.01]} />
          <meshStandardMaterial color={colorSecondary} emissive="#38bdf8" emissiveIntensity={xray ? 1.4 : 0.6} toneMapped={false} />
        </mesh>
      ) : null}

      {/* Armor plate */}
      {armorLevel !== "NONE" ? (
        <RoundedBox
          position={[0, 0.03 + p.torsoHeight * 0.2, p.torsoDepth / 2 + 0.02]}
          args={[
            p.torsoWidth * (armorLevel === "EXPERIMENTAL" ? 0.9 : armorLevel === "MODERATE" ? 0.78 : 0.6),
            p.torsoHeight * 0.3,
            0.05,
          ]}
          radius={0.02}
          smoothness={3}
        >
          <meshStandardMaterial color={colorSecondary} metalness={0.8} roughness={0.2} emissive={colorPrimary} emissiveIntensity={0.15} />
        </RoundedBox>
      ) : null}

      {/* Shoulders — small spheres for smooth joint reads */}
      {show("outer") ? (
        <>
          <mesh position={[-shoulderX, shoulderY, 0]}>
            <sphereGeometry args={[p.limbRadius * 1.05, 12, 10]} />
            <meshStandardMaterial {...outerMaterialProps} />
          </mesh>
          <mesh position={[shoulderX, shoulderY, 0]}>
            <sphereGeometry args={[p.limbRadius * 1.05, 12, 10]} />
            <meshStandardMaterial {...outerMaterialProps} />
          </mesh>
        </>
      ) : null}

      {/* Head / mask */}
      {show("mask") ? (
        <ExplodingGroup def={head} explodeAmount={explodeAmount}>
          <mesh castShadow>
            <sphereGeometry args={[0.19 * p.headScale, 24, 20]} />
            <meshStandardMaterial {...outerMaterialProps} map={patternTexture} />
          </mesh>
          {show("sensors") ? (
            <>
              <mesh position={[-0.072, 0.01, 0.16 * p.headScale]} rotation={lensRotation}>
                {lensGeometry}
                <meshStandardMaterial color={colorSecondary} emissive="#e9d5ff" emissiveIntensity={xray ? 2 : 1.1} toneMapped={false} />
              </mesh>
              <mesh position={[0.072, 0.01, 0.16 * p.headScale]} rotation={lensRotation}>
                {lensGeometry}
                <meshStandardMaterial color={colorSecondary} emissive="#e9d5ff" emissiveIntensity={xray ? 2 : 1.1} toneMapped={false} />
              </mesh>
            </>
          ) : null}
        </ExplodingGroup>
      ) : null}

      {/* Chest structural accent (explodable) */}
      {show("structural") ? (
        <ExplodingGroup def={chest} explodeAmount={explodeAmount}>
          <mesh>
            <octahedronGeometry args={[0.045, 0]} />
            <meshStandardMaterial color={colorSecondary} emissive={colorPrimary} emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
          </mesh>
        </ExplodingGroup>
      ) : null}

      {/* Arms */}
      {armParts
        .filter((d) => d.layer === "outer")
        .map((def) =>
          show("outer") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <LimbSegment radius={p.limbRadius} length={L} materialProps={outerMaterialProps} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Legs */}
      {legParts
        .filter((d) => d.layer === "outer")
        .map((def) =>
          show("outer") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <LimbSegment radius={p.limbRadius * 1.08} length={L} materialProps={outerMaterialProps} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Hands */}
      {armParts
        .filter((d) => d.layer === "gloves")
        .map((def) =>
          show("gloves") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <mesh castShadow>
                <sphereGeometry args={[p.limbRadius * 1.1, 12, 10]} />
                <meshStandardMaterial color={colorSecondary} metalness={0.5} roughness={0.4} emissive={colorPrimary} emissiveIntensity={0.2} />
              </mesh>
            </ExplodingGroup>
          ) : null
        )}

      {/* Feet */}
      {legParts
        .filter((d) => d.layer === "boots")
        .map((def) =>
          show("boots") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <RoundedBox
                castShadow
                position={[0, -0.05, 0.06]}
                args={[p.limbRadius * 2.2, p.limbRadius * 1.4, p.limbRadius * 3.4]}
                radius={0.025}
                smoothness={3}
              >
                <meshStandardMaterial color={colorSecondary} metalness={0.5} roughness={0.35} emissive={colorPrimary} emissiveIntensity={0.2} />
              </RoundedBox>
            </ExplodingGroup>
          ) : null
        )}

      {/* Pelvis */}
      {show("outer") ? (
        <RoundedBox position={[0, hipY + 0.02, 0]} args={[p.torsoWidth * 0.78, 0.16, p.torsoDepth * 0.9]} radius={0.05} smoothness={3}>
          <meshStandardMaterial {...outerMaterialProps} />
        </RoundedBox>
      ) : null}
    </group>
  );
}
