"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Lightformer } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { canvasDpr, QUALITY_BUDGETS } from "@/lib/3d/quality";
import { useQualityTier } from "@/lib/3d/useQualityTier";
import { usePrefersReducedMotion } from "@/lib/3d/useReducedMotion";
import { SuitBayStage, layoutBays, BODY_LIFT, PLATFORM_HEIGHT } from "@/components/lab/three/SuitBayStage";
import { BaySuitForm, StageCamera } from "@/components/lab/three/BaySuit";
import { GltfSuitModel, GltfErrorBoundary, CANONICAL_BODY_HEIGHT } from "@/components/lab/three/GltfSuitModel";
import { DEFAULT_BODY_MODEL_URL } from "@/components/lab/three/HolographicSuitCanvas";
import { Materialize } from "@/components/three/Materialize";
import { AssetModel } from "@/components/three/AssetModel";
import { getAsset, componentsToNodes } from "@/lib/3d/assetRegistry";
import { INITIAL_INTERACTION, type InteractionState } from "@/lib/3d/interaction";
import { loadAssetIndex } from "@/lib/3d/assetLoader";
import { lightingFor } from "@/lib/experience/world";
import { deriveExperienceState, type BrainStateName } from "@/lib/experience/state";
import { GestureRecognizer, MIN_TOUCH_TARGET_PX } from "@/lib/experience/gestures";
import { parseCommand, describeIntent } from "@/lib/experience/intents";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";
import { cn } from "@/lib/utils/cn";

/**
 * The Suit Bay as a place you are standing in.
 *
 * The previous Suit Bay was a grid of cards, each containing a small square
 * canvas: a website that happened to render 3D. This is one continuous room
 * with suits standing in it at real spacing, one camera, and interface that
 * stays out of the way of the object.
 *
 * The rules that keep it from sliding back into a dashboard:
 *
 * - **One canvas.** Everything spatial happens in the same scene, so suits have
 *   a real relationship to each other and to the floor.
 * - **The subject dominates.** UI is a thin top line and a bottom rail. No
 *   panel ever covers the suit; details appear as a small readout beside it.
 * - **Touch first.** Tap selects, double-tap isolates, long press inspects,
 *   drag orbits, pinch zooms — the shared gesture vocabulary, not mouse
 *   behaviour with touch bolted on.
 */

export interface BaySuitItem {
  id: string;
  codename: string;
  designation: string;
  archetype: string;
  status: string;
  realityStatus?: string;
  modelUrl?: string | null;
  colorPrimary: string;
  colorSecondary: string;
  silhouette?: string;
  materialLanguage?: string;
  patternStyle?: string;
  armorLevel?: string;
  maskLensStyle?: string;
  stats: { stealth: number; durability: number; mobility: number; weightKg: number; estimatedCostUsd: number } | null;
  /**
   * Registered asset id, when this suit has an authored GLB bundle.
   *
   * Present means the suit renders through the asset contract — real LODs,
   * named components, provenance — instead of through the procedural fallback.
   * Absent is the honest state for a suit nobody has authored yet.
   */
  assetId?: string | null;
}

/** How many suits stand in the room at once. The rest live in the archive. */
const MAX_BAYS = 5;

export function SuitBaySpatial({
  suits,
  brainState = "idle",
  onOpenArchive,
  onOpenDetail,
  /** Deterministic override used by the visual QA scenarios. */
  initialSelectedId,
  initialFocused = false,
}: {
  suits: BaySuitItem[];
  brainState?: BrainStateName;
  onOpenArchive?: () => void;
  onOpenDetail?: (id: string) => void;
  initialSelectedId?: string;
  initialFocused?: boolean;
}) {
  const tier = useQualityTier();
  const budget = QUALITY_BUDGETS[tier];
  const controls = useRef<OrbitControlsImpl>(null);
  const surface = useRef<HTMLDivElement>(null);

  const bayed = useMemo(() => suits.slice(0, MAX_BAYS), [suits]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? bayed[0]?.id ?? null);
  const [focused, setFocused] = useState(initialFocused);
  const [notice, setNotice] = useState<string | null>(null);
  // Registered external assets. Loaded once; `assetsReady` flips when the
  // index resolves so suits that have an authored bundle swap from the
  // procedural fallback to the real thing.
  const [assetsReady, setAssetsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAssetIndex().then((result) => {
      if (cancelled) return;
      if (result.failed.length > 0) {
        console.warn("[suit-bay] asset manifests failed to load", result.failed);
      }
      setAssetsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);

  const selected = useMemo(() => bayed.find((s) => s.id === selectedId) ?? null, [bayed, selectedId]);

  const slots = useMemo(
    () =>
      layoutBays(
        bayed.map((s) => ({ id: s.id, label: s.codename, accent: s.colorPrimary })),
      ),
    [bayed],
  );
  const selectedSlot = useMemo(() => slots.find((s) => s.id === selectedId) ?? null, [slots, selectedId]);

  // The authored bundle for the current subject, if one is registered.
  // `assetsReady` is in the deps so the lookup re-runs once the index resolves.
  const heroAsset = useMemo(
    () => (assetsReady && selected?.assetId ? getAsset(selected.assetId) : null),
    [assetsReady, selected],
  );

  // Component selection only means anything while a suit is the subject, so
  // it is DERIVED from focus rather than cleared by an effect — an effect that
  // resets state is a second source of truth and an extra render.
  const activeComponent = focused ? selectedComponent : null;

  const interaction = useMemo<InteractionState>(
    () => ({ ...INITIAL_INTERACTION, selectedId: activeComponent, hoverId: hoveredComponent }),
    [activeComponent, hoveredComponent],
  );

  const selectComponent = useCallback((id: string) => {
    setSelectedComponent((current) => (current === id ? null : id));
  }, []);

  // The room's lighting is a function of the place and what VOX is doing —
  // the same derivation the Brain uses, so both surfaces agree.
  const experience = deriveExperienceState({ brainState });
  const lighting = lightingFor(focused ? "suit" : "suit-bay", experience);

  const reducedMotion = usePrefersReducedMotion();

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setFocused(true);
  }, []);

  // Gestures on the canvas surface. OrbitControls already owns drag and pinch
  // for the camera, so this recognizer is only here for the semantic gestures
  // it does not have: double-tap to isolate and long-press to inspect.
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const recognizer = new GestureRecognizer({
      onGesture: (event) => {
        if (event.name === "double-tap") setFocused((v) => !v);
        if (event.name === "long-press" && selectedId) onOpenDetail?.(selectedId);
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
  }, [selectedId, onOpenDetail]);

  /** Text/voice command handling, using the shared intent parser. */
  const runCommand = useCallback(
    (raw: string) => {
      const intent = parseCommand(raw);
      if (!intent) {
        setNotice("Didn't catch that");
        return;
      }
      setNotice(describeIntent(intent));
      if (intent.kind === "goto" && intent.place === "suit" && intent.subject === "latest" && bayed[0]) {
        select(bayed[0].id);
      } else if (intent.kind === "goto" && intent.place === "suit-bay") {
        setFocused(false);
      } else if (intent.kind === "reset") {
        setFocused(false);
      } else if (intent.kind === "isolate") {
        setFocused(true);
      } else if (intent.kind === "inspect" && selectedId) {
        onOpenDetail?.(selectedId);
      }
    },
    [bayed, select, selectedId, onOpenDetail],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    // h-full, not 100dvh: the app shell already owns the viewport and gives
    // <main> its height. Claiming the full viewport here would push the room
    // below the header and produce the scrollbar the brief specifically rules
    // out on mobile.
    <div ref={surface} className="relative h-full min-h-[32rem] w-full overflow-hidden bg-[#050507] [touch-action:none]">
      <Canvas
        dpr={canvasDpr(tier)}
        gl={{ antialias: tier !== "MOBILE", alpha: false, powerPreference: "high-performance" }}
        camera={{ position: [0, 2.0, 8.4], fov: 38, near: 0.1, far: 60 }}
        shadows={budget.shadows}
        onPointerMissed={() => setFocused(false)}
      >
        <Suspense fallback={null}>
          {/* A small studio environment so metal reads as metal. No HDRI file
              and no network fetch — the same procedural rig the suit viewer
              already uses. */}
          <Environment resolution={256} background={false}>
            <Lightformer form="rect" intensity={0.7} color="#fffdf8" position={[4, 5, 4]} scale={[5, 6, 1]} target={[0, 1, 0]} />
            <Lightformer form="rect" intensity={0.28} color="#cfd6ff" position={[-5, 3, -3]} scale={[4, 5, 1]} target={[0, 1, 0]} />
          </Environment>

          <SuitBayStage
            slots={slots}
            selectedId={selectedId}
            focused={focused}
            lighting={lighting}
            tier={tier}
            reducedMotion={reducedMotion}
            onSelect={select}
          >
            {slots.map((slot) => {
              const suit = bayed.find((s) => s.id === slot.id);
              if (!suit) return null;
              const isSubject = slot.id === selectedId;
              return (
                <group key={slot.id} position={slot.position} rotation={[0, slot.rotation, 0]}>
                  {isSubject ? (
                    // The subject gets the real asset. Materialize gives it an
                    // arrival rather than a pop-in.
                    heroAsset ? (
                      <group position={[0, PLATFORM_HEIGHT, 0]}>
                        <GltfErrorBoundary fallback={<BaySuitForm id={slot.id} accent={suit.colorPrimary} dimmed={false} onSelect={select} />}>
                          <AssetModel
                            asset={heroAsset}
                            tier={tier}
                            targetHeight={CANONICAL_BODY_HEIGHT}
                            groundY={0}
                            nodes={componentsToNodes(heroAsset)}
                            interaction={interaction}
                            onSelect={selectComponent}
                            onHover={setHoveredComponent}
                            reducedMotion={reducedMotion}
                          />
                        </GltfErrorBoundary>
                      </group>
                    ) : (
                    <Materialize trigger={slot.id} reducedMotion={reducedMotion}>
                      <group position={[0, BODY_LIFT, 0]}>
                      <GltfErrorBoundary fallback={<BaySuitForm id={slot.id} accent={suit.colorPrimary} dimmed={false} onSelect={select} />}>
                        <GltfSuitModel
                          url={suit.modelUrl ?? DEFAULT_BODY_MODEL_URL}
                          colorPrimary={suit.colorPrimary}
                          colorSecondary={suit.colorSecondary}
                          materialLanguage={(suit.materialLanguage ?? "COMPOSITE") as MaterialLanguage}
                          patternStyle={(suit.patternStyle ?? "WEB") as PatternStyle}
                          archetype={suit.archetype}
                          silhouette={(suit.silhouette ?? "ATHLETIC") as Silhouette}
                          armorLevel={(suit.armorLevel ?? "LIGHT") as ArmorLevel}
                          maskLensStyle={(suit.maskLensStyle ?? "ANGULAR") as MaskLensStyle}
                          showEffects={budget.effects}
                        />
                      </GltfErrorBoundary>
                      </group>
                    </Materialize>
                    )
                  ) : (
                    <BaySuitForm id={slot.id} accent={suit.colorPrimary} dimmed={focused} onSelect={select} />
                  )}
                </group>
              );
            })}
          </SuitBayStage>

          <StageCamera
            controls={controls}
            subject={focused && selectedSlot ? selectedSlot.position : null}
            home={{ position: [(selectedSlot?.position[0] ?? 0) * 0.45, 2.0, 8.4], target: [(selectedSlot?.position[0] ?? 0) * 0.7, 0.95, -0.5] }}
            anchorX={selectedSlot?.position[0] ?? 0}
            distance={2.65}
            aim={CANONICAL_BODY_HEIGHT * 0.55}
            reducedMotion={reducedMotion}
          />
        </Suspense>

        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.07}
          minDistance={1.2}
          maxDistance={11}
          // Never let the camera go under the floor: a room you can fall out of
          // stops being a room.
          maxPolarAngle={Math.PI * 0.49}
          minPolarAngle={Math.PI * 0.12}
          rotateSpeed={0.55}
          zoomSpeed={0.7}
        />
      </Canvas>

      {/* ---- HUD. Thin, at the edges, never over the subject. ---- */}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div>
          <div className="lab-mono text-[10px] uppercase tracking-[0.22em] text-white/40">Suit Bay</div>
          {selected ? (
            <div className="mt-1">
              <div className="text-lg font-medium tracking-tight text-white/90">{selected.codename}</div>
              <div className="lab-mono mt-0.5 text-[10px] uppercase tracking-[0.16em] text-white/35">
                {selected.designation} · {selected.archetype}
              </div>
            </div>
          ) : null}
        </div>
        {onOpenArchive ? (
          <button
            type="button"
            onClick={onOpenArchive}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            className="pointer-events-auto rounded-full border border-white/10 bg-white/[0.04] px-4 text-[11px] uppercase tracking-[0.14em] text-white/60 backdrop-blur-sm transition-colors hover:text-white/90"
          >
            Archive
          </button>
        ) : null}
      </div>

      {/* Specification readout — beside the suit, not a card on top of it.
          Desktop only: on a phone this space belongs to the object. */}
      {/* Centred with inset-y + justify-center rather than a translate: a
          transform forces its own compositing layer, which the headless
          software rasteriser duplicated across the viewport in capture. */}
      {selected?.stats && focused ? (
        <div className="pointer-events-none absolute inset-y-0 right-6 hidden flex-col justify-center gap-2 sm:flex">
          {[
            ["Stealth", `${selected.stats.stealth}`],
            ["Durability", `${selected.stats.durability}`],
            ["Mobility", `${selected.stats.mobility}`],
            ["Mass", `${selected.stats.weightKg.toFixed(1)} kg`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-end gap-3">
              <span className="lab-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</span>
              <span className="lab-mono w-16 text-right text-sm text-white/70">{value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Selected-component readout. Text beside the object, in the same
          register as the inspector's — a component is a thing you are told
          about, not a modal you dismiss. */}
      {activeComponent && heroAsset ? (
        <div className="pointer-events-none absolute bottom-28 left-4 right-4 sm:bottom-24 sm:max-w-sm">
          <div className="lab-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: selected?.colorPrimary }}>
            {heroAsset.components.find((c) => c.id === activeComponent)?.label ?? activeComponent}
          </div>
          {(() => {
            const meta = heroAsset.components.find((c) => c.id === activeComponent)?.metadata;
            if (!meta) return null;
            return (
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                {Object.entries(meta).map(([key, value]) => (
                  <span key={key} className="lab-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    {key} <span className="text-white/60">{String(value)}</span>
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      ) : null}

      {notice ? (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
          <div className="lab-mono rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/70 backdrop-blur-sm">
            {notice}
          </div>
        </div>
      ) : null}

      {/* Bay rail. One row, comfortable targets, no card ever. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="pointer-events-auto mx-auto flex max-w-full items-center gap-2 overflow-x-auto scrollbar-none rounded-full border border-white/[0.07] bg-black/45 px-2 py-1.5 backdrop-blur-md sm:w-fit">
          {bayed.map((suit) => (
            <button
              key={suit.id}
              type="button"
              onClick={() => select(suit.id)}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-3.5 text-[11px] uppercase tracking-[0.12em] transition-colors",
                suit.id === selectedId ? "bg-white/[0.09] text-white/90" : "text-white/45 hover:text-white/75",
              )}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: suit.colorPrimary, boxShadow: suit.id === selectedId ? `0 0 8px ${suit.colorPrimary}` : undefined }}
              />
              {suit.codename}
            </button>
          ))}
        </div>
        <div className="lab-mono mt-2 hidden text-center text-[9px] uppercase tracking-[0.18em] text-white/25 sm:block">
          Drag to orbit · pinch to zoom · double tap to isolate · hold to inspect
        </div>
      </div>

      {/* Voice/text command line. Hidden affordance, real behaviour: the same
          intent parser the voice path uses. */}
      <CommandLine onRun={runCommand} />
    </div>
  );
}

function CommandLine({ onRun }: { onRun: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onRun(value);
        setValue("");
      }}
      className="pointer-events-auto absolute left-1/2 top-4 hidden -translate-x-1/2 sm:block"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Say or type a command…"
        aria-label="Spatial command"
        className="lab-mono w-72 rounded-full border border-white/[0.08] bg-black/40 px-4 py-2 text-[11px] text-white/70 placeholder:text-white/25 outline-none backdrop-blur-md focus:border-white/20"
      />
    </form>
  );
}
