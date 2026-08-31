"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Line } from "@react-three/drei";
import { cn } from "@/lib/utils/cn";
import type { BrainNode } from "@/lib/brain/graph";
import type { BrainPayload } from "@/components/brain/BrainWorkspace";
import { InspectorPanel } from "@/components/brain/InspectorPanel";
import { ActivityTimeline } from "@/components/brain/ActivityTimeline";
import { BrainStateBadge } from "@/components/brain/BrainStateBadge";
import { BrainActivityFeedCard } from "@/components/brain/BrainActivityFeedCard";
import { BrainInspectorCard } from "@/components/brain/BrainInspectorCard";
import { useBrainVisualState } from "@/components/brain/three/useBrainVisualState";
import { BrainScene } from "@/components/brain/three/BrainScene";
import { BrainMesh, type ClipAxis } from "@/components/brain/three/BrainMesh";
import { NeuralWeb } from "@/components/brain/three/NeuralWeb";
import { ActivityPulse } from "@/components/brain/three/ActivityPulse";
import { SIGNAL_HEX, SIGNAL_LABEL } from "@/lib/3d/signals";
import { buildNeuralWeb } from "@/components/brain/three/brainGeometry";
import { useQualityTier } from "@/lib/3d/useQualityTier";
import { usePrefersReducedMotion } from "@/lib/3d/useReducedMotion";
import { RegionMarker } from "@/components/brain/three/RegionMarker";
import { EntitySatellite } from "@/components/brain/three/EntitySatellite";
import { computeSatelliteOffsets, SATELLITE_REVEAL_CAP } from "@/components/brain/three/regionLayout";
import { importanceOf } from "@/components/brain/importance";
import { ChevronRightIcon, FocusIcon, LayerIcon, ResetIcon, RotateIcon, ZoomInIcon, ZoomOutIcon } from "@/components/brain/three/BrainToolbarIcons";
import {
  SYSTEM_OF,
  SYSTEM_ORDER,
  SYSTEM_LABEL,
  SYSTEM_COLOR,
  SYSTEM_ANCHOR,
  type BrainSystem,
  type Vec3,
} from "@/components/brain/three/anatomy";

function ToolbarIconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "instrument-float flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border border-transparent px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
        active && "border-accent bg-accent-muted text-accent"
      )}
    >
      {children}
      <span className="lab-mono text-[8.5px] uppercase tracking-wide">{label}</span>
    </button>
  );
}

const NARROW_VIEWPORT_QUERY = "(max-width: 640px)";

function subscribeNarrowViewport(callback: () => void) {
  const mq = window.matchMedia(NARROW_VIEWPORT_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/**
 * Phone-width viewport, for LAYOUT decisions only — which HUD controls collapse
 * behind a toggle. Camera framing used to key off this too; it no longer does
 * (see the framing note below), because a media query answers "is this a phone"
 * and framing needs "what shape is the canvas" — related, but not the same
 * question, and the canvas is not the window.
 */
function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrowViewport,
    () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
    () => false
  );
}

/**
 * Framing note (previously a per-call-site `isNarrowViewport ? x : y` pair on
 * every distance below).
 *
 * A narrow viewport shows a much narrower horizontal field at the same camera
 * distance, because `fov` is vertical — so a distance tuned on desktop crops
 * the brain edge-to-edge on a phone. That was originally patched by hand-tuning
 * a second constant for each focus mode, which meant four pairs of magic
 * numbers, each correct only at the one viewport it was eyeballed against.
 *
 * The correction is now a single aspect-aware rule in CameraRig, applied to
 * whatever distance this function returns. Every number below is therefore one
 * value with one meaning: how close to get, in world units, at a square frame.
 */

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function VoxBrain3D({ initial, onSwitchToStructural }: { initial: BrainPayload; onSwitchToStructural?: () => void }) {
  // The live graph, the event stream and their derived signals. Everything
  // below this line is view state — what the user is looking at, not what VOX
  // is doing. See useBrainVisualState for why the two are separated.
  const { nodes, edges, events, brain, nodesById, signalKinds, signalMix, pulses, liveStatus, applyPatch } =
    useBrainVisualState(initial);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedSystem, setFocusedSystem] = useState<BrainSystem | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [showActivity, setShowActivity] = useState(false);
  const [showSystems, setShowSystems] = useState(false);
  const [showFullInspector, setShowFullInspector] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [explodeAmount, setExplodeAmount] = useState(0);
  const [xray, setXray] = useState(false);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipAxis, setClipAxis] = useState<ClipAxis>("x");
  const [clipPosition, setClipPosition] = useState(0);
  // A manual multiplier on top of whatever focusDistance the current
  // selection/system/dissect state computes — the "Zoom In/Out" toolbar
  // buttons nudge this, "Focus" snaps it back to 1 (re-affirming the
  // intended framing for whatever's currently selected, undoing any drift
  // from the user's own scroll/pinch zoom), "Reset" clears it entirely.
  const [manualZoom, setManualZoom] = useState(1);
  const [forceRotate, setForceRotate] = useState(false);

  // Device budget. Re-measured on resize/orientation change, so rotating a
  // phone or moving the window to another display re-picks the tier instead
  // of holding whatever the session started at.
  const tier = useQualityTier();

  // The neural web's real vertex/edge buffers, so activity travels along the
  // structure the user can actually see rather than over the top of it.
  const web = useMemo(() => buildNeuralWeb(2), []);


  const reducedMotion = usePrefersReducedMotion();
  const isNarrowViewport = useIsNarrowViewport();

  const selectedNode = selectedNodeId ? (nodesById.get(selectedNodeId) ?? null) : null;


  // Which systems currently show their real entity satellites — the brain
  // itself is always fully visible (it's the hero, not something that
  // needs "revealing"); this only controls the small supplementary markers.
  const revealedSystems = useMemo(() => {
    if (explodeAmount > 0.15) return new Set(SYSTEM_ORDER);
    const set = new Set<BrainSystem>();
    if (focusedSystem) set.add(focusedSystem);
    if (selectedNode) {
      set.add(SYSTEM_OF[selectedNode.type]);
      for (const edge of edges) {
        if (edge.from === selectedNode.id) {
          const other = nodesById.get(edge.to);
          if (other) set.add(SYSTEM_OF[other.type]);
        } else if (edge.to === selectedNode.id) {
          const other = nodesById.get(edge.from);
          if (other) set.add(SYSTEM_OF[other.type]);
        }
      }
    }
    return set;
  }, [explodeAmount, focusedSystem, selectedNode, edges, nodesById]);

  const nodesBySystem = useMemo(() => {
    const map = new Map<BrainSystem, BrainNode[]>();
    for (const system of SYSTEM_ORDER) map.set(system, []);
    for (const node of nodes) map.get(SYSTEM_OF[node.type])?.push(node);
    return map;
  }, [nodes]);

  const { entityPositions, systemOverflow } = useMemo(() => {
    const positions = new Map<string, Vec3>();
    const overflow = new Map<BrainSystem, number>();
    for (const system of SYSTEM_ORDER) {
      if (!revealedSystems.has(system)) continue;
      const members = nodesBySystem.get(system) ?? [];
      const shown = members.length > SATELLITE_REVEAL_CAP ? [...members].sort((a, b) => importanceOf(b) - importanceOf(a)).slice(0, SATELLITE_REVEAL_CAP) : members;
      overflow.set(system, Math.max(0, members.length - SATELLITE_REVEAL_CAP));
      const offsets = computeSatelliteOffsets(shown.length);
      shown.forEach((node, i) => positions.set(node.id, add(SYSTEM_ANCHOR[system], offsets[i])));
    }
    return { entityPositions: positions, systemOverflow: overflow };
  }, [revealedSystems, nodesBySystem]);

  const revealedNodes = useMemo(() => nodes.filter((n) => entityPositions.has(n.id)), [nodes, entityPositions]);

  const relatedIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>();
    for (const edge of edges) {
      if (edge.from === selectedNode.id) set.add(edge.to);
      if (edge.to === selectedNode.id) set.add(edge.from);
    }
    return set;
  }, [selectedNode, edges]);

  const relatedNodesList = useMemo(
    () => [...relatedIds].map((id) => nodesById.get(id)).filter((n): n is BrainNode => Boolean(n)),
    [relatedIds, nodesById]
  );

  // A real hierarchy path from what's actually selected — never a
  // fabricated sub-region taxonomy the graph doesn't have.
  const breadcrumbSegments = useMemo(() => {
    const segs: { label: string; onClick?: () => void }[] = [{ label: "Brain", onClick: resetToWholeBrain }];
    const system = focusedSystem ?? (selectedNode ? SYSTEM_OF[selectedNode.type] : null);
    if (system) {
      segs.push({
        label: SYSTEM_LABEL[system],
        onClick: selectedNode
          ? () => {
              setSelectedNodeId(null);
              setFocusedSystem(system);
            }
          : undefined,
      });
    }
    if (selectedNode) {
      segs.push({ label: selectedNode.type.toLowerCase().replace(/_/g, " ") });
      segs.push({ label: selectedNode.label });
    }
    return segs;
  }, [focusedSystem, selectedNode]);

  // Only the edges touching the current selection are ever drawn — "only
  // emphasize meaningful relationships," never a permanent web across the
  // whole brain.
  const highlightedEdges = useMemo(() => {
    if (!selectedNode) return [];
    function resolve(nodeId: string): Vec3 {
      const pos = entityPositions.get(nodeId);
      if (pos) return pos;
      const node = nodesById.get(nodeId);
      return node ? SYSTEM_ANCHOR[SYSTEM_OF[node.type]] : [0, 0, 0];
    }
    return edges
      .filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
      .map((e) => ({ id: e.id, from: resolve(e.from), to: resolve(e.to) }));
  }, [selectedNode, edges, entityPositions, nodesById]);

  const { focusPosition, focusDistance } = useMemo(() => {
    function withZoom(pos: Vec3, distance: number) {
      return { focusPosition: pos, focusDistance: distance * manualZoom };
    }
    if (selectedNode) {
      const pos = entityPositions.get(selectedNode.id) ?? SYSTEM_ANCHOR[SYSTEM_OF[selectedNode.type]];
      return withZoom(pos, 1.15);
    }
    if (focusedSystem) return withZoom(SYSTEM_ANCHOR[focusedSystem], 1.3);
    if (explodeAmount > 0.4) return withZoom([0, 0, 0], 4);
    // The brain is the hero. Portrait framing is handled once, in CameraRig —
    // see the framing note above.
    return withZoom([0, 0.05, 0], 2.55);
  }, [selectedNode, focusedSystem, explodeAmount, entityPositions, manualZoom]);

  function resetToWholeBrain() {
    setSelectedNodeId(null);
    setFocusedSystem(null);
    setExplodeAmount(0);
    setXray(false);
    setClipEnabled(false);
    setManualZoom(1);
    setForceRotate(false);
    setShowFullInspector(false);
  }

  function zoomIn() {
    setManualZoom((z) => Math.max(0.45, z * 0.8));
  }
  function zoomOut() {
    setManualZoom((z) => Math.min(2.2, z * 1.25));
  }
  function refocus() {
    setManualZoom(1);
  }
  function cycleLayer() {
    if (!xray && !clipEnabled) {
      setXray(true);
    } else if (xray && !clipEnabled) {
      setXray(false);
      setClipEnabled(true);
    } else {
      setXray(false);
      setClipEnabled(false);
    }
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, nodes]);

  function selectFromSearch(node: BrainNode) {
    setFocusedSystem(null);
    setSelectedNodeId(node.id);
    setSearchQuery("");
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <BrainScene focusPosition={focusPosition} focusDistance={focusDistance} reducedMotion={reducedMotion} forceRotate={forceRotate} tier={tier} onPointerMissed={() => setSelectedNodeId(null)}>
        <BrainMesh brainState={brain.state} explodeAmount={explodeAmount} xray={xray} clipEnabled={clipEnabled} clipAxis={clipAxis} clipPosition={clipPosition} />
        {/* The reference's own Idle-state screenshot shows the connectome at
            full brightness — the network IS the brain's primary material,
            not a layer that hides at rest. It still brightens further on
            real activity (see NeuralWeb's per-state intensity/pulse-speed),
            just from a baseline that already matches what "Idle" actually
            looks like in the reference, not a faded-out default. */}
        <NeuralWeb brainState={brain.state} opacity={explodeAmount > 0.15 ? 0.45 : 0.85} />

        {/* Signals travelling the real pathways. This is what makes the Brain
            read as thinking rather than as a rotating object: emission is
            driven by the live event count, so an idle system shows an idle
            brain and a burst of work is visibly a burst of work. */}
        <ActivityPulse
          positions={web.positions}
          edges={web.edges}
          activity={events.length}
          kinds={signalKinds}
          tier={tier}
          reducedMotion={reducedMotion}
        />

        {SYSTEM_ORDER.map((system) => (
          <RegionMarker
            key={system}
            system={system}
            anchor={SYSTEM_ANCHOR[system]}
            count={(nodesBySystem.get(system) ?? []).length}
            active={revealedSystems.has(system)}
            focused={focusedSystem === system}
            pulseUntil={pulses[system] ?? null}
            onFocus={(s) => {
              setSelectedNodeId(null);
              setFocusedSystem((prev) => (prev === s ? null : s));
            }}
          />
        ))}

        {revealedNodes.map((node) => (
          <EntitySatellite
            key={node.id}
            node={node}
            targetPosition={entityPositions.get(node.id)!}
            visualState={!selectedNode ? "normal" : node.id === selectedNode.id ? "focused" : relatedIds.has(node.id) ? "normal" : "dimmed"}
            onSelect={(id) => setSelectedNodeId(id)}
          />
        ))}

        {highlightedEdges.map((e) => (
          <Line key={e.id} points={[e.from, e.to]} color="#e9d5ff" lineWidth={1.4} transparent opacity={0.85} dashed dashSize={0.05} gapSize={0.03} />
        ))}
      </BrainScene>

      {/* Top overlay bar. On narrow viewports this is a minimal, horizontally-
          scrolling strip rather than a stack of flex-wrap rows — the 3D
          object is the primary environment, so contextual controls occupy a
          single thin band instead of pushing the brain down and eating a
          third of the screen. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 sm:p-4">
        {/* Row A: always-visible essentials only — state + search. Never
            scrolls, never wraps, so these two are reachable with zero
            interaction on any viewport. */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="instrument-float flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5">
            <span className="vox-eyebrow text-[10px] text-foreground">VOX Brain</span>
            <BrainStateBadge state={brain.state} detail={brain.detail} />
          </div>

          <div className="relative ml-auto shrink-0">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the Brain…"
              className="instrument-float w-28 rounded-full px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:w-56 focus:outline-none sm:w-36"
            />
            {searchResults.length > 0 ? (
              <div className="instrument-float absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-[var(--radius-sm)] p-1">
                {searchResults.map((n) => (
                  <button key={n.id} type="button" onClick={() => selectFromSearch(n)} className="flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SYSTEM_COLOR[SYSTEM_OF[n.type]] }} />
                    <span className="truncate">{n.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Row B: secondary tools — a single horizontally-scrolling strip on
            narrow viewports instead of a multi-row wall of pills, so the
            brain gets its vertical space back; unchanged wrap layout on
            desktop, where there's room. */}
        <div className="pointer-events-auto flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-none sm:flex-wrap sm:overflow-visible">
          <button type="button" onClick={resetToWholeBrain} className="instrument-float lab-mono shrink-0 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
            Whole Brain
          </button>

          <button
            type="button"
            onClick={() => setXray((v) => !v)}
            className={cn(
              "lab-mono shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              xray ? "border-accent bg-accent-muted text-accent" : "instrument-float border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            X-Ray
          </button>

          <button
            type="button"
            onClick={() => setClipEnabled((v) => !v)}
            className={cn(
              "lab-mono shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              clipEnabled ? "border-accent bg-accent-muted text-accent" : "instrument-float border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Cutaway
          </button>
          {clipEnabled ? (
            <div className="instrument-float flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1">
              {(["x", "y", "z"] as ClipAxis[]).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => setClipAxis(axis)}
                  className={cn("lab-mono rounded-full px-1.5 py-0.5 text-[10px] uppercase", clipAxis === axis ? "bg-accent-muted text-accent" : "text-muted-foreground")}
                >
                  {axis}
                </button>
              ))}
              <input type="range" min={-1.1} max={1.1} step={0.02} value={clipPosition} onChange={(e) => setClipPosition(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
            </div>
          ) : null}

          <div className="instrument-float flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5">
            <span className="lab-mono text-[11px] uppercase tracking-wider text-muted-foreground">Dissect</span>
            <input type="range" min={0} max={100} value={Math.round(explodeAmount * 100)} onChange={(e) => setExplodeAmount(Number(e.target.value) / 100)} className="w-20 accent-[var(--accent)]" />
          </div>

          <button type="button" onClick={() => setShowActivity((v) => !v)} className="instrument-float lab-mono shrink-0 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
            Activity
          </button>
          {onSwitchToStructural ? (
            <button type="button" onClick={onSwitchToStructural} className="instrument-float lab-mono shrink-0 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
              Structural View
            </button>
          ) : null}

          {isNarrowViewport ? (
            <button
              type="button"
              onClick={() => setShowSystems((v) => !v)}
              className={cn(
                "lab-mono shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                showSystems ? "border-accent bg-accent-muted text-accent" : "instrument-float border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Systems
            </button>
          ) : null}
        </div>

        {liveStatus !== "open" ? (
          <span className="lab-mono pointer-events-none text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {liveStatus === "connecting" ? "Reconnecting to live activity…" : "Live updates unsupported in this browser"}
          </span>
        ) : null}
      </div>

      {/* Region sidebar — a plain vertical list (dot, label, count, chevron)
          against the open canvas, not a wall of pill buttons. Collapsed
          behind the "Systems" toggle on narrow viewports (still occupies
          real space over the object there); always visible on desktop,
          floating in the canvas's own left margin. */}
      {!isNarrowViewport || showSystems ? (
        <div className="pointer-events-none absolute left-3 top-20 z-[1] sm:left-5 sm:top-28">
          <div className="pointer-events-auto flex w-fit flex-col gap-2.5">
            {SYSTEM_ORDER.map((system) => {
              const count = (nodesBySystem.get(system) ?? []).length;
              const overflow = systemOverflow.get(system) ?? 0;
              return (
                <button
                  key={system}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(null);
                    setFocusedSystem((prev) => (prev === system ? null : system));
                  }}
                  className="group flex items-center gap-2 text-left"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SYSTEM_COLOR[system] }} />
                  <span className="flex flex-col leading-tight">
                    <span className={cn("lab-mono text-[10px] uppercase tracking-wide", focusedSystem === system ? "text-foreground" : "text-muted-foreground/90 group-hover:text-foreground")}>
                      {SYSTEM_LABEL[system]}
                    </span>
                    <span className="lab-mono text-[9px] text-muted-foreground/60">
                      {count}
                      {overflow > 0 ? ` (+${overflow})` : ""}
                    </span>
                  </span>
                  <ChevronRightIcon />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedNode && showFullInspector ? (
        <div className="pointer-events-auto absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto scrollbar-thin border-l border-border bg-background/95 backdrop-blur-md sm:p-3">
          <InspectorPanel
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            events={events}
            perspectiveLabel="Brain"
            focusedLabels={[...relatedIds].map((id) => nodesById.get(id)?.label).filter((v): v is string => Boolean(v))}
            isPinned={pinnedIds.has(selectedNode.id)}
            canCompare={false}
            onClose={() => setShowFullInspector(false)}
            onFocus={refocus}
            onSelectNode={(id) => setSelectedNodeId(id)}
            onGraphPatch={applyPatch}
            onTogglePin={() =>
              setPinnedIds((prev) => {
                const next = new Set(prev);
                if (next.has(selectedNode.id)) next.delete(selectedNode.id);
                else next.add(selectedNode.id);
                return next;
              })
            }
            onStartCompare={() => {}}
            onActivity={() => {}}
            onMemoryAnnotations={() => {}}
          />
        </div>
      ) : null}

      {showActivity ? (
        <div className="pointer-events-auto absolute bottom-0 left-0 z-20 max-h-[60vh] w-full overflow-hidden border-t border-border bg-background/95 backdrop-blur-md sm:bottom-3 sm:left-3 sm:max-h-[70vh] sm:w-96 sm:rounded-[var(--radius-md)] sm:border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="vox-eyebrow">Recent activity</span>
            <button type="button" onClick={() => setShowActivity(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <div className="max-h-[52vh] overflow-y-auto sm:max-h-[60vh]">
            <ActivityTimeline events={events} nodes={nodes} onSelectNode={(id) => { setSelectedNodeId(id); setShowActivity(false); }} />
          </div>
        </div>
      ) : null}

      {/* Bottom HUD: a real hierarchy breadcrumb, a scene-control icon
          toolbar, and always-on compact Activity/Inspector cards — the
          persistent "instrument panel" that replaces one-off full-screen
          overlays as the default way to see what's selected and what's
          happening. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:gap-2.5 sm:p-4">
        {/* Signal legend. Only rendered when real events have actually
            classified — an idle system shows no legend rather than a key to
            colours that aren't on screen. Counts are the real event tallies,
            so this doubles as a readout of what VOX has been doing. */}
        {signalMix.length > 0 ? (
          <div className="pointer-events-none instrument-float flex max-w-full items-center gap-2.5 overflow-x-auto scrollbar-none rounded-full px-3 py-1">
            {signalMix.map(({ kind, count }) => (
              <span key={kind} className="flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SIGNAL_HEX[kind], boxShadow: `0 0 6px ${SIGNAL_HEX[kind]}` }} />
                <span className="lab-mono whitespace-nowrap text-[10px] uppercase tracking-wide text-muted-foreground">
                  {SIGNAL_LABEL[kind]} <span className="text-foreground">{count}</span>
                </span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="pointer-events-auto instrument-float flex max-w-full items-center gap-1 overflow-x-auto scrollbar-none rounded-full px-3 py-1.5">
          {breadcrumbSegments.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 ? <ChevronRightIcon /> : null}
              {seg.onClick ? (
                <button type="button" onClick={seg.onClick} className="lab-mono whitespace-nowrap text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
                  {seg.label}
                </button>
              ) : (
                <span className="lab-mono whitespace-nowrap text-[10px] uppercase tracking-wide text-foreground">{seg.label}</span>
              )}
            </span>
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <ToolbarIconButton label="Zoom Out" onClick={zoomOut}>
            <ZoomOutIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Zoom In" onClick={zoomIn}>
            <ZoomInIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Rotate" active={forceRotate} onClick={() => setForceRotate((v) => !v)}>
            <RotateIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Reset" onClick={resetToWholeBrain}>
            <ResetIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Focus" onClick={refocus}>
            <FocusIcon />
          </ToolbarIconButton>
          <ToolbarIconButton label="Layer" active={xray || clipEnabled} onClick={cycleLayer}>
            <LayerIcon />
          </ToolbarIconButton>
        </div>

        <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:justify-center">
          <BrainActivityFeedCard events={events} nodes={nodes} liveStatus={liveStatus} onSelectNode={setSelectedNodeId} onViewAll={() => setShowActivity(true)} />
          <BrainInspectorCard
            node={selectedNode}
            relatedNodes={relatedNodesList}
            onSelectNode={setSelectedNodeId}
            onOpenFull={() => setShowFullInspector(true)}
          />
        </div>
      </div>
    </div>
  );
}
