"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils/cn";
import { useEventStream } from "@/lib/events/useEventStream";
import type { LiveEvent } from "@/lib/events/bus";
import type { BrainNode } from "@/lib/brain/graph";
import type { BrainPayload } from "@/components/brain/BrainWorkspace";
import { InspectorPanel, type GraphPatch } from "@/components/brain/InspectorPanel";
import { ActivityTimeline } from "@/components/brain/ActivityTimeline";
import { BrainStateBadge } from "@/components/brain/BrainStateBadge";
import { BrainScene } from "@/components/brain/three/BrainScene";
import { SystemAnchorPoint } from "@/components/brain/three/SystemAnchorPoint";
import { EntityNodePoint } from "@/components/brain/three/EntityNodePoint";
import { EdgeLines, type ResolvedEdge } from "@/components/brain/three/EdgeLines";
import { computeBrainLayout, DISSECT_RADIUS, SYSTEM_RADIUS, type Vec3 } from "@/components/brain/three/layout3d";
import { SYSTEM_OF, SYSTEM_ORDER, SYSTEM_LABEL, SYSTEM_COLOR, SUBJECT_TYPE_TO_SYSTEM, type BrainSystem } from "@/components/brain/three/systems";

const PULSE_MS = 1600;

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export function VoxBrain3D({ initial, onSwitchToStructural }: { initial: BrainPayload; onSwitchToStructural?: () => void }) {
  const [nodes, setNodes] = useState<BrainNode[]>(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [events, setEvents] = useState(initial.events);
  const [brain, setBrain] = useState(initial.brain);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedSystem, setFocusedSystem] = useState<BrainSystem | null>(null);
  const [dissected, setDissected] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [showActivity, setShowActivity] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pulses, setPulses] = useState<Partial<Record<BrainSystem, number>>>({});
  const reducedMotion = usePrefersReducedMotion();

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? (nodesById.get(selectedNodeId) ?? null) : null;

  // Real authoritative refetch — same pattern as BrainWorkspace's own
  // refreshGraph/handleLiveEvent (see src/components/brain/BrainWorkspace.tsx):
  // a live event never mutates local state by guesswork, it just triggers a
  // debounced re-read of the real graph from the server.
  const refreshGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/graph");
      if (!res.ok) return;
      const data: BrainPayload = await res.json();
      setNodes(data.nodes);
      setEdges(data.edges);
      setEvents(data.events);
      setBrain(data.brain);
    } catch {
      // transient network hiccup — next event/poll retries
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshGraph, 60000);
    return () => clearInterval(interval);
  }, [refreshGraph]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLiveEvent = useCallback(
    (event: LiveEvent) => {
      setEvents((prev) => [{ id: event.id, type: event.type, subjectType: event.subjectType, subjectId: event.subjectId, createdAt: event.createdAt }, ...prev].slice(0, 60));

      const system = event.subjectType ? SUBJECT_TYPE_TO_SYSTEM[event.subjectType] : undefined;
      if (system) setPulses((prev) => ({ ...prev, [system]: performance.now() + PULSE_MS }));

      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refreshGraph, 600);
    },
    [refreshGraph]
  );
  const { status: liveStatus } = useEventStream({ onEvent: handleLiveEvent });
  useEffect(() => () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); }, []);

  const revealedSystems = useMemo(() => {
    if (dissected) return new Set(SYSTEM_ORDER);
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
  }, [dissected, focusedSystem, selectedNode, edges, nodesById]);

  const layout = useMemo(() => computeBrainLayout(nodes, dissected, revealedSystems), [nodes, dissected, revealedSystems]);
  const anchorPositionBySystem = useMemo(() => new Map(layout.anchors.map((a) => [a.system, a.position])), [layout.anchors]);

  const relatedIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>();
    for (const edge of edges) {
      if (edge.from === selectedNode.id) set.add(edge.to);
      if (edge.to === selectedNode.id) set.add(edge.from);
    }
    return set;
  }, [selectedNode, edges]);

  const highlightedEdgeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    return new Set(edges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id).map((e) => e.id));
  }, [selectedNode, edges]);

  const resolvedEdges: ResolvedEdge[] = useMemo(() => {
    function resolve(nodeId: string): Vec3 {
      const pos = layout.nodePositions.get(nodeId);
      if (pos) return pos;
      const node = nodesById.get(nodeId);
      const anchor = node ? anchorPositionBySystem.get(SYSTEM_OF[node.type]) : undefined;
      return anchor ?? [0, 0, 0];
    }
    return edges.map((edge) => ({ edge, from: resolve(edge.from), to: resolve(edge.to) }));
  }, [edges, layout.nodePositions, nodesById, anchorPositionBySystem]);

  const revealedNodes = useMemo(() => nodes.filter((n) => layout.nodePositions.has(n.id)), [nodes, layout.nodePositions]);

  const { focusPosition, focusDistance } = useMemo(() => {
    if (selectedNode) {
      const pos = layout.nodePositions.get(selectedNode.id) ?? anchorPositionBySystem.get(SYSTEM_OF[selectedNode.type]) ?? ([0, 0, 0] as Vec3);
      return { focusPosition: pos, focusDistance: 4.2 };
    }
    if (focusedSystem) {
      const pos = anchorPositionBySystem.get(focusedSystem) ?? ([0, 0, 0] as Vec3);
      return { focusPosition: pos, focusDistance: 6.5 };
    }
    if (dissected) return { focusPosition: [0, 0, 0] as Vec3, focusDistance: DISSECT_RADIUS + 6.5 };
    return { focusPosition: [0, 0, 0] as Vec3, focusDistance: SYSTEM_RADIUS + 7 };
  }, [selectedNode, focusedSystem, dissected, layout.nodePositions, anchorPositionBySystem]);

  function resetToWholeBrain() {
    setSelectedNodeId(null);
    setFocusedSystem(null);
    setDissected(false);
  }

  function applyGraphPatch(patch: GraphPatch) {
    if (patch.kind === "addNodes") setNodes((prev) => [...prev, ...patch.nodes]);
    else if (patch.kind === "addEdges") setEdges((prev) => [...prev, ...patch.edges]);
    else if (patch.kind === "updateNode") setNodes((prev) => prev.map((n) => (n.id === patch.id ? { ...n, ...patch.patch } : n)));
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, nodes]);

  function selectFromSearch(node: BrainNode) {
    setDissected(false);
    setFocusedSystem(null);
    setSelectedNodeId(node.id);
    setSearchQuery("");
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <BrainScene
        brainState={brain.state}
        focusPosition={focusPosition}
        focusDistance={focusDistance}
        reducedMotion={reducedMotion}
        onPointerMissed={() => setSelectedNodeId(null)}
      >
        {layout.anchors.map((anchor) => (
          <SystemAnchorPoint
            key={anchor.system}
            anchor={anchor}
            active={dissected || focusedSystem === anchor.system || revealedSystems.has(anchor.system)}
            pulseUntil={pulses[anchor.system] ?? null}
            onFocus={(system) => {
              setSelectedNodeId(null);
              setFocusedSystem((prev) => (prev === system ? null : system));
            }}
          />
        ))}
        {revealedNodes.map((node) => (
          <EntityNodePoint
            key={node.id}
            node={node}
            targetPosition={layout.nodePositions.get(node.id)!}
            visualState={!selectedNode ? "normal" : node.id === selectedNode.id ? "focused" : relatedIds.has(node.id) ? "normal" : "dimmed"}
            onSelect={(id) => setSelectedNodeId(id)}
          />
        ))}
        <EdgeLines resolved={resolvedEdges} highlightedIds={highlightedEdgeIds} dimmed={Boolean(selectedNode)} />
      </BrainScene>

      {/* Top overlay bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 sm:p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="glass-panel-strong flex items-center gap-2 rounded-full px-3 py-1.5">
            <span className="vox-eyebrow text-[10px] text-foreground">VOX Brain</span>
            <BrainStateBadge state={brain.state} detail={brain.detail} />
          </div>

          <button
            type="button"
            onClick={resetToWholeBrain}
            className="glass-panel-strong lab-mono rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            Whole Brain
          </button>
          {focusedSystem && !dissected ? (
            <span className="glass-panel-strong lab-mono rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent">
              {SYSTEM_LABEL[focusedSystem]}
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setDissected((d) => !d);
              setFocusedSystem(null);
              setSelectedNodeId(null);
            }}
            className={cn(
              "lab-mono rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              dissected ? "border-accent bg-accent-muted text-accent" : "glass-panel-strong border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {dissected ? "Reassemble" : "Dissect"}
          </button>

          <div className="relative ml-auto">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the Brain…"
              className="glass-panel-strong w-40 rounded-full px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:w-56 focus:outline-none"
            />
            {searchResults.length > 0 ? (
              <div className="glass-panel-strong absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-[var(--radius-sm)] p-1">
                {searchResults.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => selectFromSearch(n)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SYSTEM_COLOR[SYSTEM_OF[n.type]] }} />
                    <span className="truncate">{n.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowActivity((v) => !v)}
            className="glass-panel-strong lab-mono rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            Activity
          </button>
          {onSwitchToStructural ? (
            <button
              type="button"
              onClick={onSwitchToStructural}
              className="glass-panel-strong lab-mono rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              Structural View
            </button>
          ) : null}
        </div>

        {/* System legend — real, keyboard-reachable buttons mirroring the 3D anchors, satisfying the same navigation without requiring pointer/orbit interaction. */}
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          {layout.anchors.map((anchor) => (
            <button
              key={anchor.system}
              type="button"
              onClick={() => {
                setSelectedNodeId(null);
                setFocusedSystem((prev) => (prev === anchor.system ? null : anchor.system));
              }}
              className={cn(
                "lab-mono flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide transition-colors",
                focusedSystem === anchor.system || dissected
                  ? "border-[var(--border-strong)] bg-surface text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SYSTEM_COLOR[anchor.system] }} />
              {SYSTEM_LABEL[anchor.system]}
              <span className="text-muted-foreground/70">{anchor.count}</span>
            </button>
          ))}
        </div>

        {liveStatus !== "open" ? (
          <span className="lab-mono pointer-events-none text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {liveStatus === "connecting" ? "Reconnecting to live activity…" : "Live updates unsupported in this browser"}
          </span>
        ) : null}
      </div>

      {/* Inspector — reused verbatim from the 2D graph so entity fields, AI actions, and relationship navigation stay identical. */}
      {selectedNode ? (
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
            onClose={() => setSelectedNodeId(null)}
            onFocus={() => {}}
            onSelectNode={(id) => setSelectedNodeId(id)}
            onGraphPatch={applyGraphPatch}
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

      {/* Recent activity — the temporal-replay foundation: real, timestamped Event rows, reused from the 2D graph's own timeline. Full scrub-through-time replay is not built this pass. */}
      {showActivity ? (
        <div className="pointer-events-auto absolute bottom-0 left-0 z-10 max-h-[60vh] w-full overflow-hidden border-t border-border bg-background/95 backdrop-blur-md sm:bottom-3 sm:left-3 sm:max-h-[70vh] sm:w-96 sm:rounded-[var(--radius-md)] sm:border">
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
    </div>
  );
}
