"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { NodeCard } from "@/components/brain/NodeCard";
import { InspectorPanel, type GraphPatch } from "@/components/brain/InspectorPanel";
import { BrainStateBadge } from "@/components/brain/BrainStateBadge";
import { PerspectiveTabs, type Perspective } from "@/components/brain/PerspectiveTabs";
import { ActivityTimeline } from "@/components/brain/ActivityTimeline";
import { layoutRadial, layoutGrid, type Point } from "@/components/brain/layout";
import type { BrainNode, BrainEdge, BrainState } from "@/lib/brain/graph";

interface ActivityEvent {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

interface BrainPayload {
  nodes: BrainNode[];
  edges: BrainEdge[];
  totals: { memories: number; research: number; tasks: number };
  brain: { state: BrainState; detail: string | null };
  events: ActivityEvent[];
}

const POSITIONS_KEY = "vox-brain-positions-v1";
const MIN_SCALE = 0.28;
const MAX_SCALE = 2.4;
const LOD_THRESHOLD = 0.55;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function filterByPerspective(nodes: BrainNode[], perspective: Perspective): BrainNode[] {
  switch (perspective) {
    case "MAP":
      return nodes;
    case "OBJECTIVE":
      return nodes.filter((n) => n.type === "OBJECTIVE" || n.type === "OPPORTUNITY");
    case "OPPORTUNITY":
      return nodes.filter((n) => n.type === "OBJECTIVE" || n.type === "OPPORTUNITY" || n.type === "RESEARCH" || n.type === "PROJECT");
    case "PROJECT":
      return nodes.filter((n) => n.type === "PROJECT" || n.type === "TASK");
    case "MEMORY":
      return nodes.filter((n) => n.type === "MEMORY");
    case "RESEARCH":
      return nodes.filter((n) => n.type === "RESEARCH" || n.type === "OPPORTUNITY");
    case "SYSTEM":
      return nodes.filter((n) => n.type === "CONNECTION");
    case "ACTIVITY":
      return [];
  }
}

function usePositions(nodes: BrainNode[], perspective: Perspective) {
  const [overrides, setOverrides] = useState<Record<string, Point>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POSITIONS_KEY);
      if (raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOverrides(JSON.parse(raw));
      }
    } catch {
      // corrupt/blocked storage — start fresh, not fatal
    }
  }, []);

  const persist = useCallback((next: Record<string, Point>) => {
    try {
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(next));
    } catch {
      // storage full/blocked — positions just won't survive reload, non-fatal
    }
  }, []);

  const filtered = useMemo(() => filterByPerspective(nodes, perspective), [nodes, perspective]);
  const computed = useMemo(
    () => (perspective === "MEMORY" || perspective === "SYSTEM" ? layoutGrid(filtered, -300, -260, 5, 170) : layoutRadial(filtered)),
    [filtered, perspective]
  );

  const resolved = useMemo(() => {
    const map = new Map<string, Point>();
    for (const n of filtered) {
      map.set(n.id, overrides[n.id] ?? computed.get(n.id) ?? { x: 0, y: 0 });
    }
    return map;
  }, [filtered, computed, overrides]);

  return { filtered, resolved, overrides, setOverrides, persist };
}

export function BrainWorkspace({ initial }: { initial: BrainPayload }) {
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [events, setEvents] = useState(initial.events);
  const [brain, setBrain] = useState(initial.brain);
  const [perspective, setPerspective] = useState<Perspective>("MAP");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<string[]>([]);
  const [viewport, setViewport] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 0.85 });
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const centeredOnce = useRef(false);

  const { filtered, resolved, setOverrides, persist } = usePositions(nodes, perspective);

  const filteredIds = useMemo(() => new Set(filtered.map((n) => n.id)), [filtered]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => filteredIds.has(e.from) && filteredIds.has(e.to)),
    [edges, filteredIds]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const neighborIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const s = new Set<string>();
    for (const e of visibleEdges) {
      if (e.from === selectedId) s.add(e.to);
      if (e.to === selectedId) s.add(e.from);
    }
    return s;
  }, [selectedId, visibleEdges]);

  // Poll for real state changes (agent runs, proposals, new events) — same
  // cadence/pattern as the rest of the app's live-activity polling.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/brain/graph");
        if (!res.ok) return;
        const data: BrainPayload = await res.json();
        setNodes(data.nodes);
        setEdges(data.edges);
        setEvents(data.events);
        setBrain(data.brain);
      } catch {
        // transient network hiccup — next tick retries
      }
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // Center the camera on the active objective (or the origin) once, on first load.
  useEffect(() => {
    if (centeredOnce.current) return;
    if (filtered.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const objective = filtered.find((n) => n.type === "OBJECTIVE");
    const target = objective ? resolved.get(objective.id) : { x: 0, y: 0 };
    if (!target) return;
    centeredOnce.current = true;
    const rect = container.getBoundingClientRect();
    setViewport((v) => ({ x: rect.width / 2 - target.x * v.scale, y: rect.height / 2 - target.y * v.scale, scale: v.scale }));
  }, [filtered, resolved]);

  function recenterOn(nodeId: string) {
    const container = containerRef.current;
    const point = resolved.get(nodeId);
    if (!container || !point) return;
    const rect = container.getBoundingClientRect();
    const scale = clamp(Math.max(viewport.scale, 0.9), MIN_SCALE, MAX_SCALE);
    setViewport({ x: rect.width / 2 - point.x * scale, y: rect.height / 2 - point.y * scale, scale });
  }

  function selectNode(node: BrainNode) {
    setSelectedId((prev) => {
      if (prev && prev !== node.id) setSelectionHistory((h) => [...h, prev]);
      return node.id;
    });
    setMobileSheetOpen(true);
  }

  function goBack() {
    setSelectionHistory((h) => {
      if (h.length === 0) {
        setSelectedId(null);
        return h;
      }
      const next = [...h];
      const prev = next.pop();
      setSelectedId(prev ?? null);
      return next;
    });
  }

  function applyPatch(patch: GraphPatch) {
    if (patch.kind === "addNodes") {
      setNodes((prev) => [...prev, ...patch.nodes]);
    } else if (patch.kind === "addEdges") {
      setEdges((prev) => [...prev, ...patch.edges]);
    } else if (patch.kind === "updateNode") {
      setNodes((prev) => prev.map((n) => (n.id === patch.id ? { ...n, ...patch.patch } : n)));
    }
  }

  // --- pan / pinch-zoom / node-drag -------------------------------------

  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number; midWorld: Point } | null>(null);
  const movedRef = useRef(false);

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/non-native pointer session — pan still works via the move/up listeners below
    }
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;

    if (activePointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y };
      pinchStart.current = null;
    } else if (activePointers.current.size === 2) {
      panStart.current = null;
      const pts = [...activePointers.current.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const rect = el.getBoundingClientRect();
      const midX = (pts[0]!.x + pts[1]!.x) / 2;
      const midY = (pts[0]!.y + pts[1]!.y) / 2;
      pinchStart.current = {
        dist,
        scale: viewport.scale,
        midWorld: { x: (midX - rect.left - viewport.x) / viewport.scale, y: (midY - rect.top - viewport.y) / viewport.scale },
      };
    }
  }

  function onContainerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1 && panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      setViewport((v) => ({ ...v, x: panStart.current!.vx + dx, y: panStart.current!.vy + dy }));
    } else if (activePointers.current.size === 2 && pinchStart.current) {
      movedRef.current = true;
      const pts = [...activePointers.current.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const rect = e.currentTarget.getBoundingClientRect();
      const midX = (pts[0]!.x + pts[1]!.x) / 2;
      const midY = (pts[0]!.y + pts[1]!.y) / 2;
      const newScale = clamp(pinchStart.current.scale * (dist / Math.max(1, pinchStart.current.dist)), MIN_SCALE, MAX_SCALE);
      setViewport({
        x: midX - rect.left - pinchStart.current.midWorld.x * newScale,
        y: midY - rect.top - pinchStart.current.midWorld.y * newScale,
        scale: newScale,
      });
    }
  }

  function onContainerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) {
      if (!movedRef.current) {
        setSelectedId(null);
        setSelectionHistory([]);
      }
      panStart.current = null;
    }
    if (activePointers.current.size < 2) pinchStart.current = null;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = container!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      setViewport((v) => {
        const newScale = clamp(v.scale * (1 - e.deltaY * 0.0012), MIN_SCALE, MAX_SCALE);
        const worldX = (cursorX - v.x) / v.scale;
        const worldY = (cursorY - v.y) / v.scale;
        return { x: cursorX - worldX * newScale, y: cursorY - worldY * newScale, scale: newScale };
      });
    }
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  function onNodePointerDown(e: React.PointerEvent, node: BrainNode) {
    e.stopPropagation();
    const origin = resolved.get(node.id) ?? { x: 0, y: 0 };
    const startX = e.clientX;
    const startY = e.clientY;
    const scale = viewport.scale;
    let moved = false;

    function move(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      if (moved) {
        setOverrides((prev) => ({ ...prev, [node.id]: { x: origin.x + dx, y: origin.y + dy } }));
      }
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        setOverrides((prev) => {
          persist(prev);
          return prev;
        });
      }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function zoomBy(factor: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setViewport((v) => {
      const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (rect.width / 2 - v.x) / v.scale;
      const worldY = (rect.height / 2 - v.y) / v.scale;
      return { x: rect.width / 2 - worldX * newScale, y: rect.height / 2 - worldY * newScale, scale: newScale };
    });
  }

  const compact = viewport.scale < LOD_THRESHOLD;
  const isGraphPerspective = perspective !== "ACTIVITY";

  return (
    <div className="flex h-full min-h-[520px] w-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[var(--surface-solid)]/70 px-3 py-2 backdrop-blur-md sm:px-4">
        <PerspectiveTabs value={perspective} onChange={setPerspective} />
        <div className="flex items-center gap-2">
          {selectionHistory.length > 0 || selectedId ? (
            <button type="button" onClick={goBack} className="text-xs text-muted-foreground hover:text-foreground">
              ← Back
            </button>
          ) : null}
          <BrainStateBadge state={brain.state} detail={brain.detail} />
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {isGraphPerspective ? (
          <div
            ref={containerRef}
            className="relative flex-1 touch-none overflow-hidden bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--accent)_7%,transparent),transparent_55%)]"
            onPointerDown={onContainerPointerDown}
            onPointerMove={onContainerPointerMove}
            onPointerUp={onContainerPointerUp}
            onPointerCancel={onContainerPointerUp}
          >
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title={emptyTitle(perspective)}
                  description={emptyDescription(perspective)}
                />
              </div>
            ) : (
              <div
                className="absolute left-0 top-0"
                style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`, transformOrigin: "0 0" }}
              >
                <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }}>
                  {visibleEdges.map((edge) => {
                    const from = resolved.get(edge.from);
                    const to = resolved.get(edge.to);
                    if (!from || !to) return null;
                    const dimmed = selectedId ? edge.from !== selectedId && edge.to !== selectedId : false;
                    return (
                      <line
                        key={edge.id}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke="var(--border-strong)"
                        strokeWidth={1}
                        opacity={dimmed ? 0.06 : 0.35}
                      />
                    );
                  })}
                </svg>
                {filtered.map((node) => {
                  const p = resolved.get(node.id) ?? { x: 0, y: 0 };
                  return (
                    <NodeCard
                      key={node.id}
                      node={node}
                      x={p.x}
                      y={p.y}
                      selected={node.id === selectedId}
                      dimmed={selectedId != null && node.id !== selectedId && !neighborIds.has(node.id)}
                      compact={compact}
                      onSelect={selectNode}
                      onPointerDownNode={onNodePointerDown}
                    />
                  );
                })}
              </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[10px] text-muted">
              <p>{filtered.length} objects in view · drag to pan · pinch/scroll to zoom</p>
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => zoomBy(1.25)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[var(--surface-solid)]/80 text-foreground backdrop-blur-md"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => zoomBy(0.8)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[var(--surface-solid)]/80 text-foreground backdrop-blur-md"
                aria-label="Zoom out"
              >
                −
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <ActivityTimeline events={events} />
          </div>
        )}

        {/* Desktop inspector: side panel. Mobile: bottom sheet. */}
        {selectedNode ? (
          <>
            <div
              data-testid="brain-inspector"
              className="hidden w-[340px] shrink-0 border-l border-border bg-[var(--surface-solid)]/90 backdrop-blur-md lg:block"
            >
              <InspectorPanel
                node={selectedNode}
                nodes={nodes}
                edges={edges}
                events={events}
                onClose={() => setSelectedId(null)}
                onFocus={() => recenterOn(selectedNode.id)}
                onSelectNode={(id) => {
                  const target = nodes.find((n) => n.id === id);
                  if (target) selectNode(target);
                }}
                onGraphPatch={applyPatch}
              />
            </div>

            {mobileSheetOpen ? (
              <div
                data-testid="brain-inspector"
                className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] rounded-t-2xl border-t border-border bg-[var(--surface-solid)] shadow-2xl lg:hidden"
              >
                <div className="flex justify-center pb-1 pt-2">
                  <span className="h-1 w-10 rounded-full bg-border" />
                </div>
                <InspectorPanel
                  node={selectedNode}
                  nodes={nodes}
                  edges={edges}
                  events={events}
                  onClose={() => {
                    setSelectedId(null);
                    setMobileSheetOpen(false);
                  }}
                  onFocus={() => recenterOn(selectedNode.id)}
                  onSelectNode={(id) => {
                    const target = nodes.find((n) => n.id === id);
                    if (target) selectNode(target);
                  }}
                  onGraphPatch={applyPatch}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function emptyTitle(perspective: Perspective): string {
  switch (perspective) {
    case "MEMORY":
      return "No confirmed memories yet";
    case "RESEARCH":
      return "No research run yet";
    case "SYSTEM":
      return "No connections live yet";
    case "OBJECTIVE":
      return "No objective set";
    default:
      return "Nothing here yet";
  }
}

function emptyDescription(perspective: Perspective): string {
  switch (perspective) {
    case "MEMORY":
      return "Confirmed memories will appear here as they build up.";
    case "RESEARCH":
      return "Research an opportunity from the Opportunity perspective to see it here.";
    case "SYSTEM":
      return "Connect a service from the Connections Hub to see it here.";
    case "OBJECTIVE":
      return "Create an objective to see it here.";
    default:
      return "This perspective is empty right now — VOX won't invent something to show.";
  }
}
