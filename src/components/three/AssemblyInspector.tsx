"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { OrbitControls, Environment, Lightformer, ContactShadows, Html, Line } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { approach } from "@/lib/3d/animation";
import { canvasDpr, QUALITY_BUDGETS } from "@/lib/3d/quality";
import { useQualityTier } from "@/lib/3d/useQualityTier";
import { usePrefersReducedMotion } from "@/lib/3d/useReducedMotion";
import { MOTION } from "@/lib/experience/motion";
import { LIGHTING } from "@/lib/experience/world";
import { GestureRecognizer, MIN_TOUCH_TARGET_PX } from "@/lib/experience/gestures";
import { partOffset, type Assembly, type AssemblyPart } from "@/lib/experience/assembly";
import { PROVENANCE_LABEL, engineeringFor, formatMeasurement, specRows } from "@/lib/lab/engineering";
import { createChamferedSlab } from "@/components/lab/three/panelGeometry";
import { cn } from "@/lib/utils/cn";

/**
 * The component inspector: any assembly, taken apart and put back together.
 *
 * It renders an `Assembly` from lib/experience/assembly and knows nothing about
 * what the object is — a wrist device today, a mask or a sensor tomorrow, with
 * no changes here. That is the point: the signature VOX interaction should be
 * available to every future object, not reimplemented per gadget.
 *
 * Geometry is defined per part below rather than loaded, because no GLB for
 * this hardware exists yet. It is deliberately machined-looking — chamfered
 * slabs, turned cylinders, real proportions in millimetres — and lit on a
 * neutral bench, so it reads as a mechanism at inspection range rather than as
 * a pile of primitives. When a real asset arrives it replaces `PartMesh` and
 * nothing else moves.
 */

/** Bench scale: the whole device is about 90mm long. Real hardware sizes. */
interface PartShape {
  build: () => THREE.BufferGeometry;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Metal, polymer or seal — drives the material response. */
  material: "alloy" | "polymer" | "seal" | "glass";
}

const SHAPES: Record<string, PartShape> = {
  wristHousing: {
    build: () => createChamferedSlab(0.052, 0.03, 0.086, 0.004),
    position: [0, 0, 0],
    material: "alloy",
  },
  wristCartridge: {
    build: () => new THREE.CylinderGeometry(0.0115, 0.0115, 0.052, 28, 1),
    position: [0, -0.012, 0.012],
    rotation: [Math.PI / 2, 0, 0],
    material: "polymer",
  },
  wristMechanism: {
    build: () => createChamferedSlab(0.022, 0.019, 0.034, 0.003),
    position: [0.016, 0.008, -0.006],
    material: "alloy",
  },
  wristNozzle: {
    build: () => new THREE.CylinderGeometry(0.0042, 0.0078, 0.019, 24, 1),
    position: [0, -0.002, -0.05],
    rotation: [Math.PI / 2, 0, 0],
    material: "alloy",
  },
  wristTrigger: {
    build: () => createChamferedSlab(0.016, 0.006, 0.026, 0.002),
    position: [0, -0.018, -0.018],
    material: "polymer",
  },
  wristInterface: {
    build: () => new THREE.TorusGeometry(0.0135, 0.0028, 12, 32),
    position: [-0.016, 0.004, 0.008],
    rotation: [0, Math.PI / 2, 0],
    material: "seal",
  },
};

function useMaterials(accent: string) {
  return useMemo(() => {
    const alloy = new THREE.MeshStandardMaterial({
      color: "#9aa0ab",
      roughness: 0.34,
      metalness: 0.92,
      envMapIntensity: 1.1,
    });
    const polymer = new THREE.MeshStandardMaterial({
      color: "#1d1f26",
      roughness: 0.55,
      metalness: 0.08,
      envMapIntensity: 0.7,
    });
    const seal = new THREE.MeshStandardMaterial({
      color: "#3b3f4a",
      roughness: 0.78,
      metalness: 0.15,
      envMapIntensity: 0.5,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.12,
      metalness: 0.2,
      emissive: new THREE.Color(accent),
      emissiveIntensity: 0.35,
      envMapIntensity: 1.4,
    });
    return { alloy, polymer, seal, glass };
  }, [accent]);
}

function PartMesh({
  part,
  amount,
  count,
  selected,
  hovered,
  accent,
  materials,
  reducedMotion,
  onSelect,
  onHover,
}: {
  part: AssemblyPart;
  amount: number;
  count: number;
  selected: boolean;
  hovered: boolean;
  accent: string;
  materials: ReturnType<typeof useMaterials>;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const shape = SHAPES[part.id];
  const group = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3());
  const geometry = useMemo(() => shape?.build() ?? new THREE.BoxGeometry(0.01, 0.01, 0.01), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = materials[shape?.material ?? "alloy"];

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    const [x, y, z] = partOffset(part, amount, count);
    const rate = 1 / MOTION[amount > 0 ? "EXPLODE" : "REASSEMBLE"].duration;
    const k = reducedMotion ? 1 : approach(rate * 3.2, delta);
    current.current.x += (x - current.current.x) * k;
    current.current.y += (y - current.current.y) * k;
    current.current.z += (z - current.current.z) * k;
    node.position.set(
      (shape?.position[0] ?? 0) + current.current.x,
      (shape?.position[1] ?? 0) + current.current.y,
      (shape?.position[2] ?? 0) + current.current.z,
    );
  });

  return (
    <group ref={group} rotation={shape?.rotation ?? [0, 0, 0]}>
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(part.id);
        }}
        onPointerOut={() => onHover(null)}
      />
      {/* Selection reads as a thin edge on the part's own silhouette, not as a
          colour swap: a highlighted alloy part that turns flat violet tells the
          user less about the object than no highlight at all. */}
      {selected || hovered ? (
        <mesh geometry={geometry} scale={1.035}>
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={selected ? 0.28 : 0.12}
            side={THREE.BackSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Leader-line callouts on a separated assembly.
 *
 * An exploded view without labels is a pile of parts. The line is what turns it
 * into an engineering drawing: it says "this floating object is that named
 * thing", which is the entire reason to take something apart in front of
 * somebody.
 *
 * Labels only appear once the assembly is genuinely open (past `MIN_SEPARATION`)
 * because a leader line pointing into a solid object is noise, and they fade
 * with the same value that drives the separation so the two read as one motion.
 * Values come from the engineering record and carry their provenance — a target
 * is labelled as a target.
 */
const MIN_SEPARATION = 0.45;

function Callout({
  part,
  amount,
  count,
  accent,
  side,
  selected,
}: {
  part: AssemblyPart;
  amount: number;
  count: number;
  accent: string;
  side: 1 | -1;
  selected: boolean;
}) {
  const shape = SHAPES[part.id];
  const record = engineeringFor(part.id);

  const { origin, elbow, end } = useMemo(() => {
    const [ox, oy, oz] = partOffset(part, 1, count);
    const base = shape?.position ?? [0, 0, 0];
    const o = new THREE.Vector3(base[0] + ox, base[1] + oy, base[2] + oz);
    // Out to a common vertical rail, so the labels line up as a column instead
    // of scattering around the object the way per-part offsets would.
    const rail = side * 0.185;
    const e = new THREE.Vector3(rail, o.y, o.z);
    const f = new THREE.Vector3(rail + side * 0.008, o.y, o.z);
    return { origin: o, elbow: e, end: f };
  }, [part, count, shape, side]);

  const visible = amount >= MIN_SEPARATION;
  if (!visible) return null;

  const fade = Math.min(1, (amount - MIN_SEPARATION) / (1 - MIN_SEPARATION));

  return (
    <group>
      <Line
        points={[origin, elbow, end]}
        color={selected ? accent : "#8f97a8"}
        lineWidth={selected ? 1.6 : 1}
        transparent
        opacity={fade * (selected ? 0.9 : 0.45)}
      />
      <Html
        position={end}
        center={false}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: "none", opacity: fade, transform: side === 1 ? "translateY(-50%)" : "translate(-100%, -50%)" }}
      >
        <div style={{ width: 168, textAlign: side === 1 ? "left" : "right", whiteSpace: "nowrap" }}>
          <div
            className="lab-mono text-[11px] uppercase tracking-[0.16em]"
            style={{ color: selected ? accent : "rgba(255,255,255,0.72)" }}
          >
            {part.label}
          </div>
          {record?.material ? (
            <div className="lab-mono mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/35">{record.material}</div>
          ) : null}
          {record?.mass ? (
            <div className="lab-mono mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/45">
              {formatMeasurement(record.mass)}{" "}
              <span className="text-white/25">{PROVENANCE_LABEL[record.mass.provenance]}</span>
            </div>
          ) : null}
        </div>
      </Html>
    </group>
  );
}

/**
 * Pulls the camera back as the assembly separates.
 *
 * The assembled device is ~90mm and deserves a tight frame; separated it spans
 * closer to 190mm. Holding one distance for both means either a distant view of
 * an assembled object or parts flying out of frame — the capture showed the
 * second. The dolly runs along the current view direction so it composes with
 * whatever angle the user has orbited to.
 */
function ExplodeDolly({ amount, reducedMotion }: { amount: number; reducedMotion: boolean }) {
  const camera = useThree((s: RootState) => s.camera);
  const controls = useThree((s: RootState) => s.controls) as OrbitControlsImpl | null;

  useFrame((_, delta) => {
    const target = 0.165 + amount * 0.2;
    const k = reducedMotion ? 1 : approach(2.2, delta);
    const centre = controls?.target ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(centre);
    const current = offset.length() || target;
    offset.setLength(current + (target - current) * k);
    camera.position.copy(centre).add(offset);
  });

  return null;
}

export interface AssemblyInspectorProps {
  assembly: Assembly;
  accent?: string;
  /** Deterministic starting state, used by the visual QA scenarios. */
  initialExplode?: number;
  initialSelectedId?: string | null;
  /** Hides the built-in controls when a parent supplies its own. */
  chrome?: boolean;
}

export function AssemblyInspector({
  assembly,
  accent = "#a78bfa",
  initialExplode = 0,
  initialSelectedId = null,
  chrome = true,
}: AssemblyInspectorProps) {
  const tier = useQualityTier();
  const budget = QUALITY_BUDGETS[tier];
  const reducedMotion = usePrefersReducedMotion();
  const controls = useRef<OrbitControlsImpl>(null);
  const surface = useRef<HTMLDivElement>(null);

  const [explode, setExplode] = useState(initialExplode);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const materials = useMaterials(accent);
  const selected = assembly.parts.find((p) => p.id === selectedId) ?? null;
  const lighting = LIGHTING.bench;

  // Long press separates the assembly; double tap puts it back. The same
  // vocabulary as every other surface.
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const recognizer = new GestureRecognizer({
      onGesture: (event) => {
        if (event.name === "long-press") setExplode(1);
        if (event.name === "double-tap") setExplode(0);
      },
    });
    const down = (e: PointerEvent) => recognizer.down(e.pointerId, e.clientX, e.clientY);
    const move = (e: PointerEvent) => recognizer.move(e.pointerId, e.clientX, e.clientY);
    const up = (e: PointerEvent) => recognizer.up(e.pointerId);
    const cancel = (e: PointerEvent) => recognizer.cancel(e.pointerId);
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    const timer = window.setInterval(() => recognizer.tick(), 50);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div ref={surface} className="relative h-full min-h-[28rem] w-full overflow-hidden bg-[#08080b] [touch-action:none]">
      <Canvas
        dpr={canvasDpr(tier)}
        gl={{ antialias: tier !== "MOBILE", alpha: false, powerPreference: "high-performance" }}
        camera={{ position: [0.115, 0.075, 0.145], fov: 34, near: 0.005, far: 4 }}
        shadows={budget.shadows}
        onPointerMissed={() => setSelectedId(null)}
      >
        <color attach="background" args={["#08080b"]} />
        {/* Bench lighting: brighter and more neutral than the bay. A material
            cannot be judged honestly under a violet key. */}
        <ambientLight intensity={lighting.ambient} color="#dcdce6" />
        <directionalLight position={[0.2, 0.35, 0.25]} intensity={lighting.key} color="#fffdf9" castShadow={budget.shadows} shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-0.25, 0.1, -0.2]} intensity={lighting.rim} color={accent} />

        <Environment resolution={256} background={false}>
          <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[0.3, 0.5, 0.4]} scale={[0.5, 0.6, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={0.5} color="#cdd6ff" position={[-0.4, 0.2, -0.3]} scale={[0.4, 0.5, 1]} target={[0, 0, 0]} />
        </Environment>

        <group>
          {assembly.parts.map((part) => (
            <PartMesh
              key={part.id}
              part={part}
              amount={explode}
              count={assembly.parts.length}
              selected={part.id === selectedId}
              hovered={part.id === hoveredId}
              accent={accent}
              materials={materials}
              reducedMotion={reducedMotion}
              onSelect={setSelectedId}
              onHover={setHoveredId}
            />
          ))}
        </group>

        {/* One column of callouts down the left, the way a drawing sheet
            annotates: alternating sides pushed half of them off-frame,
            because the camera views the assembly from an angle. */}
        {assembly.parts.map((part) => (
          <Callout
            key={`callout-${part.id}`}
            part={part}
            amount={explode}
            count={assembly.parts.length}
            accent={accent}
            side={-1}
            selected={part.id === selectedId}
          />
        ))}

        <ExplodeDolly amount={explode} reducedMotion={reducedMotion} />

        {budget.shadows ? <ContactShadows position={[0, -0.028, 0]} opacity={0.5} scale={0.35} blur={2.2} far={0.12} /> : null}

        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.1}
          maxDistance={0.5}
          rotateSpeed={0.5}
          zoomSpeed={0.6}
          autoRotate={!reducedMotion && explode === 0 && !selectedId}
          autoRotateSpeed={0.4}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 p-4">
        <div className="lab-mono text-[10px] uppercase tracking-[0.22em] text-white/40">{assembly.label}</div>
        <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-white/45">{assembly.summary}</p>
      </div>

      {/* Selected-part readout. A line of text beside the object, never a
          panel over it. */}
      {selected ? (
        <div className="pointer-events-none absolute bottom-24 left-4 right-4 sm:bottom-20 sm:max-w-sm">
          <div className="lab-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: accent }}>
            {selected.label}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-white/70">{selected.function}</p>
          {/* Engineering record, when one exists. Every value states its
              provenance: a design target is not a measurement, and an
              interface that renders both identically is lying by omission. */}
          {(() => {
            const record = engineeringFor(selected.id);
            const rows = record ? specRows(record) : [];
            if (rows.length === 0) return null;
            return (
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt className="lab-mono text-[9px] uppercase tracking-[0.14em] text-white/30">{row.label}</dt>
                    <dd className="lab-mono text-[10px] text-white/65">
                      {row.value}
                      {row.provenance ? (
                        <span
                          className="ml-2 rounded-full border px-1.5 py-px text-[8px] uppercase tracking-[0.12em]"
                          style={{
                            borderColor: row.provenance === "REAL" ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.14)",
                            color: row.provenance === "REAL" ? "rgba(34,211,238,0.85)" : "rgba(255,255,255,0.35)",
                          }}
                          title={row.note}
                        >
                          {PROVENANCE_LABEL[row.provenance]}
                        </span>
                      ) : null}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            );
          })()}
        </div>
      ) : null}

      {chrome ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button
            type="button"
            onClick={() => setExplode(explode > 0 ? 0 : 1)}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            className={cn(
              "rounded-full border px-5 text-[11px] uppercase tracking-[0.14em] backdrop-blur-md transition-colors",
              explode > 0
                ? "border-white/20 bg-white/[0.09] text-white/90"
                : "border-white/[0.08] bg-black/40 text-white/55 hover:text-white/85",
            )}
          >
            {explode > 0 ? "Reassemble" : "Exploded view"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
