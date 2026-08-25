"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import {
  createEmblemTexture,
  createEmissiveMaskTexture,
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

/** A tapered-limb profile revolved into real geometry (THREE.LatheGeometry) —
 * replaces a uniform-radius capsule with a shape that actually bulges at the
 * joint (bicep/thigh) and narrows toward the extremity (wrist/ankle), which
 * is what makes a limb read as a limb instead of a rod. `endScale` narrows
 * the far end further for lower-arm/lower-leg segments vs upper ones. */
function buildLimbProfile(radius: number, length: number, endScale: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(radius * 0.72, -length * 0.02),
    new THREE.Vector2(radius * 1.0, -length * 0.14),
    new THREE.Vector2(radius * 1.06, -length * 0.34),
    new THREE.Vector2(radius * 0.88, -length * 0.55),
    new THREE.Vector2(radius * endScale * 0.84, -length * 0.75),
    new THREE.Vector2(radius * endScale * 0.76, -length * 0.94),
    new THREE.Vector2(radius * endScale * 0.68, -length * 0.99),
    new THREE.Vector2(0, -length),
  ];
}

/** A limb segment hanging from its parent group's origin (the joint). The
 * Lathe profile already spans from y=0 (joint) to y=-length, so the mesh
 * sits at the group origin with no extra offset needed. */
function LimbSegment({
  radius,
  length,
  endScale = 1,
  materialProps,
}: {
  radius: number;
  length: number;
  endScale?: number;
  materialProps: Record<string, unknown>;
}) {
  const geometry = useMemo(() => {
    const profile = buildLimbProfile(radius, length, endScale);
    return new THREE.LatheGeometry(profile, 12);
  }, [radius, length, endScale]);

  return (
    <mesh castShadow geometry={geometry}>
      <meshStandardMaterial {...materialProps} />
    </mesh>
  );
}

/** A real glove silhouette — a flattened rounded palm plus an offset thumb —
 * instead of a bare sphere. `mirror` flips the thumb to the inside of
 * whichever hand it's on. */
function Hand({
  radius,
  mirror,
  colorSecondary,
  colorPrimary,
}: {
  radius: number;
  mirror: 1 | -1;
  colorSecondary: string;
  colorPrimary: string;
}) {
  const gloveMaterial = { color: colorSecondary, metalness: 0.5, roughness: 0.4, emissive: colorPrimary, emissiveIntensity: 0.2 };
  return (
    <group>
      <RoundedBox castShadow args={[radius * 1.65, radius * 1.35, radius * 2.05]} radius={radius * 0.55} smoothness={3}>
        <meshStandardMaterial {...gloveMaterial} />
      </RoundedBox>
      <mesh castShadow position={[mirror * radius * 0.95, -radius * 0.08, radius * 0.35]} rotation={[0.15, 0, mirror * -0.55]}>
        <capsuleGeometry args={[radius * 0.34, radius * 0.62, 4, 6]} />
        <meshStandardMaterial {...gloveMaterial} />
      </mesh>
    </group>
  );
}

/** A boot: a narrower ankle block over an elongated, flatter sole block —
 * two shapes instead of one, which is what separates "boot" from "box". */
function Boot({ radius, colorSecondary, colorPrimary }: { radius: number; colorSecondary: string; colorPrimary: string }) {
  const bootMaterial = { color: colorSecondary, metalness: 0.5, roughness: 0.35, emissive: colorPrimary, emissiveIntensity: 0.2 };
  const soleMaterial = { color: colorSecondary, metalness: 0.15, roughness: 0.75 };
  return (
    <group position={[0, -radius * 0.55, radius * 0.1]}>
      <RoundedBox castShadow position={[0, radius * 0.42, -radius * 0.15]} args={[radius * 1.3, radius * 1.35, radius * 1.55]} radius={radius * 0.3} smoothness={3}>
        <meshStandardMaterial {...bootMaterial} />
      </RoundedBox>
      <RoundedBox castShadow position={[0, -radius * 0.28, radius * 0.42]} args={[radius * 1.55, radius * 0.5, radius * 2.75]} radius={radius * 0.18} smoothness={3}>
        <meshStandardMaterial {...soleMaterial} />
      </RoundedBox>
    </group>
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
  // A black background with the same line geometry in white — multiplies
  // against the flat `emissive` color below so ONLY the traced lines
  // actually glow, instead of `emissive` (which has no spatial variation
  // on its own) washing the entire suit toward one flat color regardless
  // of the diffuse map underneath it.
  const emissiveMaskTexture = useMemo(() => createEmissiveMaskTexture(patternStyle), [patternStyle]);
  const emblemTexture = useMemo(() => createEmblemTexture(colorPrimary), [colorPrimary]);

  const show = (l: SuitLayer) => visibleLayers.has(l);
  const outerOpacity = xray ? 0.14 : 1;

  // `map` bakes a near-black colorSecondary base with the pattern's lines
  // traced in colorPrimary — the suit's real dominant material — with
  // `color` left white so that two-tone diffuse texture reads unmodified
  // under the studio lights. `emissiveMap` (the mask above) is what makes
  // those same lines actually glow.
  const outerMaterialProps = {
    color: "#ffffff",
    metalness: mat.metalness,
    roughness: mat.roughness,
    emissive: colorPrimary,
    emissiveMap: emissiveMaskTexture,
    emissiveIntensity: mat.emissiveIntensity * 4.5 * (xray ? 1.4 : 1),
    map: patternTexture,
    transparent: true,
    opacity: outerOpacity,
  };

  const L = 0.36; // limb segment length
  const shoulderY = p.torsoHeight / 2 - 0.06;
  const hipY = -p.torsoHeight / 2;
  const hipX = p.torsoWidth / 2.6;
  const shoulderX = p.shoulderWidth / 2;

  // Torso silhouette: a wider chest tapering to a narrower waist, instead of
  // one uniform box — the single biggest cue that reads as "a body" rather
  // than "a rounded brick". The overall bounding span (0.03 ± torsoHeight/2)
  // is unchanged, so every joint computed from it (shoulderY, hipY, the
  // chest accent, the armor plate, the structural/thermal overlays) still
  // lines up correctly.
  const chestH = p.torsoHeight * 0.56;
  const waistH = p.torsoHeight - chestH;
  const torsoTop = 0.03 + p.torsoHeight / 2;
  const torsoBottom = 0.03 - p.torsoHeight / 2;
  const chestY = torsoTop - chestH / 2;
  const waistY = torsoBottom + waistH / 2;
  const waistWidth = p.torsoWidth * 0.8;
  const waistDepth = p.torsoDepth * 0.88;

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
      {/* Torso (outer shell) — chest + waist, tapered for a real silhouette */}
      {show("outer") ? (
        <>
          <RoundedBox
            castShadow
            position={[0, chestY, 0]}
            args={[p.torsoWidth, chestH, p.torsoDepth]}
            radius={Math.min(0.09, p.torsoDepth * 0.35)}
            smoothness={4}
          >
            <meshStandardMaterial {...outerMaterialProps} />
          </RoundedBox>
          <RoundedBox
            castShadow
            position={[0, waistY, 0]}
            args={[waistWidth, waistH, waistDepth]}
            radius={Math.min(0.08, waistDepth * 0.35)}
            smoothness={4}
          >
            <meshStandardMaterial {...outerMaterialProps} />
          </RoundedBox>
          {/* Neck — closes the gap between the shoulder line and the head */}
          <mesh castShadow position={[0, shoulderY + 0.045, 0]}>
            <cylinderGeometry args={[p.limbRadius * 0.6 * p.headScale, p.limbRadius * 0.75 * p.headScale, 0.09, 12]} />
            <meshStandardMaterial {...outerMaterialProps} />
          </mesh>
        </>
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

      {/* Armor plate — same map/emissiveMap-driven material as the rest of the
          shell (just higher metalness/lower roughness for a "raised plate"
          read) so it blends into the suit's surface language instead of
          reading as a flat, unpatterned sticker dropped on top of it. */}
      {armorLevel !== "NONE" ? (
        <RoundedBox
          position={[0, 0.03 + p.torsoHeight * 0.2, p.torsoDepth / 2 + 0.006]}
          args={[
            p.torsoWidth * (armorLevel === "EXPERIMENTAL" ? 0.62 : armorLevel === "MODERATE" ? 0.52 : 0.42),
            p.torsoHeight * 0.22,
            0.018,
          ]}
          radius={0.02}
          smoothness={3}
        >
          <meshStandardMaterial {...outerMaterialProps} metalness={0.75} roughness={0.18} />
        </RoundedBox>
      ) : null}

      {/* Shoulders — squashed, enlarged caps so they blend into the torso
          and upper-arm meshes instead of floating as visible bare spheres */}
      {show("outer") ? (
        <>
          <mesh position={[-shoulderX, shoulderY, 0]} scale={[1, 0.82, 1]}>
            <sphereGeometry args={[p.limbRadius * 1.3, 14, 10]} />
            <meshStandardMaterial {...outerMaterialProps} />
          </mesh>
          <mesh position={[shoulderX, shoulderY, 0]} scale={[1, 0.82, 1]}>
            <sphereGeometry args={[p.limbRadius * 1.3, 14, 10]} />
            <meshStandardMaterial {...outerMaterialProps} />
          </mesh>
        </>
      ) : null}

      {/* Head / mask — a scaled ellipsoid instead of a perfect sphere, so it
          reads as a head/cowl rather than a ball sitting on the shoulders */}
      {show("mask") ? (
        <ExplodingGroup def={head} explodeAmount={explodeAmount}>
          <mesh castShadow scale={[0.94, 1.1, 0.98]}>
            <sphereGeometry args={[0.19 * p.headScale, 26, 20]} />
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

      {/* Emblem — the suit's real identity mark: a drawn spider silhouette
          (front and back), not part of the tiled panel-line pattern. An
          unlit decal so it reads as a genuine glow regardless of the
          studio lighting angle, matching the reference's "Emblem Core". */}
      {show("outer") ? (
        <>
          <mesh position={[0, chestY + 0.02, p.torsoDepth / 2 + 0.022]}>
            <planeGeometry args={[p.torsoWidth * 0.62, p.torsoWidth * 0.62]} />
            <meshBasicMaterial map={emblemTexture} transparent opacity={xray ? 0.5 : 0.95} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, chestY, -(p.torsoDepth / 2 + 0.012)]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[p.torsoWidth * 0.5, p.torsoWidth * 0.5]} />
            <meshBasicMaterial map={emblemTexture} transparent opacity={xray ? 0.4 : 0.75} toneMapped={false} depthWrite={false} />
          </mesh>
        </>
      ) : null}

      {/* Arms — tapered upper segment (wide at shoulder) into a narrower
          tapered forearm (endScale pulls the wrist end in further) */}
      {armParts
        .filter((d) => d.layer === "outer")
        .map((def) =>
          show("outer") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <LimbSegment radius={p.limbRadius} length={L} endScale={def.name.startsWith("lower") ? 0.8 : 1} materialProps={outerMaterialProps} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Legs — same tapering treatment, slightly thicker base radius */}
      {legParts
        .filter((d) => d.layer === "outer")
        .map((def) =>
          show("outer") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <LimbSegment radius={p.limbRadius * 1.08} length={L} endScale={def.name.startsWith("lower") ? 0.82 : 1} materialProps={outerMaterialProps} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Hands — real glove silhouette (palm + thumb), not a bare sphere */}
      {armParts
        .filter((d) => d.layer === "gloves")
        .map((def) =>
          show("gloves") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <Hand radius={p.limbRadius} mirror={def.name.endsWith("L") ? 1 : -1} colorSecondary={colorSecondary} colorPrimary={colorPrimary} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Feet — ankle block + sole, not a single box */}
      {legParts
        .filter((d) => d.layer === "boots")
        .map((def) =>
          show("boots") ? (
            <ExplodingGroup key={def.name} def={def} explodeAmount={explodeAmount}>
              <Boot radius={p.limbRadius * 1.15} colorSecondary={colorSecondary} colorPrimary={colorPrimary} />
            </ExplodingGroup>
          ) : null
        )}

      {/* Pelvis */}
      {show("outer") ? (
        <RoundedBox position={[0, hipY + 0.02, 0]} args={[waistWidth * 0.98, 0.16, waistDepth]} radius={0.05} smoothness={3}>
          <meshStandardMaterial {...outerMaterialProps} />
        </RoundedBox>
      ) : null}
    </group>
  );
}
