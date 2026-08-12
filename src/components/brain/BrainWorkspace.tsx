"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { NodeCard, type NodeLOD } from "@/components/brain/NodeCard";
import { InspectorPanel, type GraphPatch, type MemoryAnnotation } from "@/components/brain/InspectorPanel";
import { CompareView } from "@/components/brain/CompareView";
import { OrbitAnnotations, annotationConnectors, type AnnotationItem } from "@/components/brain/Annotations";
import { BrainStateBadge } from "@/components/brain/BrainStateBadge";
import { PerspectiveTabs, perspectiveLabel, type Perspective } from "@/components/brain/PerspectiveTabs";
import { ActivityTimeline } from "@/components/brain/ActivityTimeline";
import { layoutRadial, layoutGrid, layoutFocus, type Point } from "@/components/brain/layout";
import { AskVoxPanel } from "@/components/brain/AskVoxPanel";
import { importanceOf } from "@/components/brain/importance";
import type { BrainNode, BrainEdge, BrainState } from "@/lib/brain/graph";
import type { BrainGroupDTO } from "@/lib/brain/groups";

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
const PINNED_KEY = "vox-brain-pinned-v1";
const DENSITY_KEY = "vox-brain-density-v1";
type Density = "LOW" | "MEDIUM" | "HIGH";
// Minimum importanceOf() score to render at each density tier — purely a
// display filter (see usePositions below): nothing is deleted or mutated,
// lower tiers just hide lower-importance nodes from this render.
const DENSITY_THRESHOLD: Record<Density, number> = { LOW: 0.7, MEDIUM: 0.45, HIGH: 0 };
const MIN_SCALE = 0.28;
const MAX_SCALE = 2.4;
// Real 3-tier LOD thresholds: below OVERVIEW_MAX show dots/labels only,
// above EXPLORE_MIN show full cards. The current focus anchor always
// renders at the richest "focus" tier regardless of zoom.
const OVERVIEW_MAX = 0.5;

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
      return nodes.filter((n) => n.type === "CONNECTION" || n.type === "AGENT_RUN" || n.type === "PROPOSAL");
    case "ACTIVITY":
      return [];
  }
}

function usePersistedSet(key: string) {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIds(new Set(JSON.parse(raw)));
      }
    } catch {
      // corrupt/blocked storage — start fresh, not fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          // storage full/blocked — non-fatal
        }
        return next;
      });
    },
    [key]
  );

  return { ids, toggle };
}

function usePositions(nodes: BrainNode[], perspective: Perspective, density: Density, keepIds: Set<string>) {
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

  const perspectiveFiltered = useMemo(() => filterByPerspective(nodes, perspective), [nodes, perspective]);
  const filtered = useMemo(() => {
    const threshold = DENSITY_THRESHOLD[density];
    if (threshold === 0) return perspectiveFiltered;
    return perspectiveFiltered.filter((n) => keepIds.has(n.id) || importanceOf(n) >= threshold);
  }, [perspectiveFiltered, density, keepIds]);
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

  return { filtered, resolved, computed, overrides, setOverrides, persist };
}

export function BrainWorkspace({ initial }: { initial: BrainPayload }) {
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [events, setEvents] = useState(initial.events);
  const [brain, setBrain] = useState(initial.brain);
  const [perspective, setPerspective] = useState<Perspective>("MAP");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [viewport, setViewport] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 0.85 });
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [memoryAnnotations, setMemoryAnnotations] = useState<AnnotationItem[]>([]);
  const [activity, setActivity] = useState<{ state: BrainState; detail: string | null } | null>(null);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [comparePicking, setComparePicking] = useState(false);
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: BrainNode } | null>(null);
  const [groups, setGroups] = useState<BrainGroupDTO[]>([]);
  const [groupPrompt, setGroupPrompt] = useState<{ memberIds: string[]; name: string } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [groupAskTarget, setGroupAskTarget] = useState<BrainGroupDTO | null>(null);
  const [attentionObjectiveId, setAttentionObjectiveId] = useState<string | null>(null);
  const [matterOpen, setMatterOpen] = useState(false);
  const [matterObjectiveId, setMatterObjectiveId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const centeredOnce = useRef(false);

  useEffect(() => {
    fetch("/api/brain/groups")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setGroups(data.groups);
      })
      .catch(() => {
        // transient — groups bar just stays empty until next successful fetch
      });
  }, []);

  const [density, setDensity] = useState<Density>("HIGH");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DENSITY_KEY);
      if (raw === "LOW" || raw === "MEDIUM" || raw === "HIGH") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDensity(raw);
      }
    } catch {
      // corrupt/blocked storage — default density stands
    }
  }, []);
  function changeDensity(d: Density) {
    setDensity(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      // storage full/blocked — the choice just won't survive reload
    }
  }

  const { ids: pinnedIds, toggle: togglePin } = usePersistedSet(PINNED_KEY);
  // Attention mode already declutters by dimming everything unrelated, so
  // density (which hides rather than dims) steps aside while it's active —
  // otherwise the two decluttering mechanisms could hide a node attention
  // mode is trying to draw the eye to.
  const effectiveDensity: Density = attentionObjectiveId ? "HIGH" : density;
  const densityKeepIds = useMemo(() => {
    const s = new Set(pinnedIds);
    if (selectedId) s.add(selectedId);
    return s;
  }, [pinnedIds, selectedId]);

  const { filtered, resolved, computed, setOverrides, persist } = usePositions(nodes, perspective, effectiveDensity, densityKeepIds);

  const filteredIds = useMemo(() => new Set(filtered.map((n) => n.id)), [filtered]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => filteredIds.has(e.from) && filteredIds.has(e.to)),
    [edges, filteredIds]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const compareNodeA = compareA ? (nodes.find((n) => n.id === compareA) ?? null) : null;
  const compareNodeB = compareB ? (nodes.find((n) => n.id === compareB) ?? null) : null;

  const neighborIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const s = new Set<string>();
    for (const e of visibleEdges) {
      if (e.from === selectedId) s.add(e.to);
      if (e.to === selectedId) s.add(e.from);
    }
    return s;
  }, [selectedId, visibleEdges]);

  // Real relationship count per node, from the *full* edge set (not just the
  // current perspective's filtered subset) — Level 2/3 detail is honest
  // about how connected something really is, not just within this view.
  const relationshipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of edges) {
      counts.set(e.from, (counts.get(e.from) ?? 0) + 1);
      counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  // Attention Mode — everything transitively reachable from the active
  // objective via the *real* edge set (opportunities → their projects →
  // tasks/agent runs, opportunities → research). Distinct from Focus: Focus
  // reorganizes around one entity, Attention subdues everything unrelated to
  // one objective while leaving the rest of the layout untouched.
  function reachableFromObjective(objectiveId: string, edgeList: BrainEdge[]): Set<string> {
    const rootId = `OBJECTIVE:${objectiveId}`;
    const visited = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of edgeList) {
        if (e.from === current && !visited.has(e.to)) {
          visited.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return visited;
  }

  function findBlockers(reachable: Set<string>, nodeList: BrainNode[]): { id: string; label: string; reason: string }[] {
    const items: { id: string; label: string; reason: string }[] = [];
    for (const n of nodeList) {
      if (!reachable.has(n.id)) continue;
      if (n.type === "OPPORTUNITY" && !n.meta.nextAction) {
        items.push({ id: n.id, label: n.label, reason: "no next action recorded" });
      }
      if (n.type === "TASK" && n.status !== "DONE" && n.meta.dueDate && new Date(n.meta.dueDate as string) < new Date()) {
        items.push({ id: n.id, label: n.label, reason: "overdue" });
      }
      if (n.type === "AGENT_RUN" && n.status === "WAITING_FOR_PERMISSION") {
        items.push({ id: n.id, label: n.label, reason: "waiting for your approval" });
      }
      if (n.type === "AGENT_RUN" && n.status === "FAILED") {
        items.push({ id: n.id, label: n.label, reason: "failed" });
      }
    }
    return items;
  }

  const attentionIds = useMemo(() => {
    if (!attentionObjectiveId) return null;
    return reachableFromObjective(attentionObjectiveId, edges);
  }, [attentionObjectiveId, edges]);

  const attentionBlockers = useMemo(() => {
    if (!attentionIds) return [];
    return findBlockers(attentionIds, nodes);
  }, [attentionIds, nodes]);

  function enterAttentionForObjective(objectiveId: string) {
    setAttentionObjectiveId(objectiveId);
    const objective = nodes.find((n) => n.id === `OBJECTIVE:${objectiveId}`);
    if (objective) {
      const query = `${objective.label} ${objective.meta.description ?? ""}`.trim();
      fetch(`/api/brain/context?query=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setMemoryAnnotations(data.memories.map((m: MemoryAnnotation) => ({ id: m.id, label: "Memory", value: m.content })));
        })
        .catch(() => {
          // transient — attention mode still works without the memory trace
        });
    }
  }

  function toggleAttention(objectiveId: string) {
    if (attentionObjectiveId === objectiveId) {
      setAttentionObjectiveId(null);
      return;
    }
    enterAttentionForObjective(objectiveId);
  }

  // "What Matters Now" — composes existing real signals (next best action,
  // pending proposals, unfinished high-priority work, blockers) for the
  // active objective into one honest summary, then attention-focuses the
  // Brain on it. Never invents a priority or a reason not already in the data.
  const whatMattersNow = useMemo(() => {
    if (!matterObjectiveId) return null;
    const objective = nodes.find((n) => n.id === `OBJECTIVE:${matterObjectiveId}`);
    if (!objective) return null;
    const reachable = reachableFromObjective(matterObjectiveId, edges);
    const nextBestAction = nodes.find((n) => n.type === "OPPORTUNITY" && reachable.has(n.id) && n.meta.isNextBestAction) ?? null;
    const pendingProposals = nodes.filter((n) => n.type === "PROPOSAL" && n.status === "PROPOSED");
    const highPriorityTasks = nodes.filter(
      (n) => n.type === "TASK" && reachable.has(n.id) && n.meta.priority === "HIGH" && n.status !== "DONE"
    );
    const blockers = findBlockers(reachable, nodes);
    return { objective, nextBestAction, pendingProposals, highPriorityTasks, blockers };
  }, [matterObjectiveId, nodes, edges]);

  function openWhatMattersNow() {
    const active = nodes.find((n) => n.type === "OBJECTIVE" && n.status === "ACTIVE") ?? nodes.find((n) => n.type === "OBJECTIVE") ?? null;
    setMatterObjectiveId(active?.entityId ?? null);
    setMatterOpen(true);
    if (active) enterAttentionForObjective(active.entityId);
  }

  // Focus layout reorganizes the workspace around the selection instead of
  // just dimming in place — direct neighbors ring in close, everything else
  // recedes to an outer ring at roughly its normal-layout angle.
  const focusPositions = useMemo(() => {
    if (!focusMode || !selectedId || !filteredIds.has(selectedId)) return null;
    return layoutFocus(filtered, visibleEdges, selectedId, computed);
  }, [focusMode, selectedId, filtered, visibleEdges, computed, filteredIds]);

  const displayPositions = focusPositions ?? resolved;

  const pullApartItems = useMemo<AnnotationItem[]>(() => {
    if (!focusMode || !selectedNode || selectedNode.type !== "OPPORTUNITY") return [];
    const m = selectedNode.meta;
    const items: AnnotationItem[] = [];
    if (m.estimatedValue != null) items.push({ id: "value", label: "Value", value: String(m.estimatedValue) });
    if (m.effort) items.push({ id: "effort", label: "Effort", value: String(m.effort) });
    items.push({ id: "confidence", label: "Confidence", value: String(m.confidence) });
    if (m.risk) items.push({ id: "risk", label: "Risk", value: String(m.risk) });
    if (m.nextAction) items.push({ id: "next", label: "Next action", value: String(m.nextAction) });
    return items;
  }, [focusMode, selectedNode]);

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

  function clearMultiSelect() {
    setMultiSelectIds(new Set());
  }

  function openGroupPromptForSelected() {
    const ids = multiSelectIds.size > 0 ? [...multiSelectIds] : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const first = nodes.find((n) => n.id === ids[0]);
    setGroupPrompt({ memberIds: ids, name: ids.length === 1 ? `${first?.label ?? "Group"}` : `Group of ${ids.length}` });
  }

  function centerCamera(point: Point, scale?: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const s = clamp(scale ?? viewport.scale, MIN_SCALE, MAX_SCALE);
    setViewport({ x: rect.width / 2 - point.x * s, y: rect.height / 2 - point.y * s, scale: s });
  }

  function selectNode(node: BrainNode, e?: { shiftKey?: boolean }) {
    if (comparePicking) {
      if (node.type === "OPPORTUNITY" && node.id !== compareA) {
        setCompareB(node.id);
        setComparePicking(false);
      }
      return;
    }
    if (e?.shiftKey) {
      setMultiSelectIds((prev) => {
        const next = new Set(prev);
        if (next.size === 0 && selectedId && selectedId !== node.id) next.add(selectedId);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      setSelectedId(node.id);
      return;
    }
    clearMultiSelect();
    setSelectedId((prev) => {
      if (prev && prev !== node.id) setSelectionHistory((h) => [...h, prev]);
      return node.id;
    });
    setFocusMode(false);
    setMobileSheetOpen(true);
    setMemoryAnnotations([]);
  }

  function focusNode(node: BrainNode) {
    if (comparePicking) {
      selectNode(node);
      return;
    }
    setSelectedId((prev) => {
      if (prev && prev !== node.id) setSelectionHistory((h) => [...h, prev]);
      return node.id;
    });
    setFocusMode(true);
    setMobileSheetOpen(true);
    setMemoryAnnotations([]);
    setTimeout(() => centerCamera({ x: 0, y: 0 }, 1.05), 0);
  }

  // Universal search result selection — switches to MAP (which always
  // contains every node type) so the result is guaranteed to be visible,
  // then focuses it exactly like a double-click would.
  function goToNode(node: BrainNode) {
    setPerspective("MAP");
    clearMultiSelect();
    focusNode(node);
    setSearchOpen(false);
    setSearchQuery("");
  }

  function enterFocusForSelected() {
    if (!selectedNode) return;
    setFocusMode(true);
    setTimeout(() => centerCamera({ x: 0, y: 0 }, 1.05), 0);
  }

  function exitFocus() {
    if (!focusMode) return;
    setFocusMode(false);
    if (selectedId) {
      const point = resolved.get(selectedId);
      if (point) setTimeout(() => centerCamera(point, viewport.scale), 0);
    }
  }

  function goBack() {
    setMemoryAnnotations([]);
    setSelectionHistory((h) => {
      if (h.length === 0) {
        setSelectedId(null);
        setFocusMode(false);
        return h;
      }
      const next = [...h];
      const prev = next.pop();
      setSelectedId(prev ?? null);
      setFocusMode(false);
      return next;
    });
  }

  // The full Brain keyboard-shortcut language (Esc/Space/F/Enter/C/G//?) —
  // every key here maps to a real, already-wired action, never a decorative
  // no-op. Typing in a text field never triggers these.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          return;
        }
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        if (groupPrompt) {
          setGroupPrompt(null);
          return;
        }
        if (groupAskTarget) {
          setGroupAskTarget(null);
          return;
        }
        if (comparePicking) {
          setComparePicking(false);
          setCompareA(null);
          return;
        }
        if (compareA || compareB) {
          setCompareA(null);
          setCompareB(null);
          return;
        }
        if (focusMode) {
          exitFocus();
          return;
        }
        if (attentionObjectiveId) {
          setAttentionObjectiveId(null);
          return;
        }
        if (multiSelectIds.size > 0) {
          clearMultiSelect();
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          setSelectionHistory([]);
        }
        return;
      }

      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (searchOpen || helpOpen) return;

      if (e.key === " ") {
        if (selectedId) {
          e.preventDefault();
          const point = resolved.get(selectedId);
          if (point) centerCamera(point, viewport.scale);
        }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (selectedNode) enterFocusForSelected();
        return;
      }
      if (e.key === "Enter") {
        if (selectedNode && !focusMode) enterFocusForSelected();
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (selectedNode?.type === "OPPORTUNITY" && nodes.some((n) => n.type === "OPPORTUNITY" && n.id !== selectedNode.id)) {
          setCompareA(selectedNode.id);
          setComparePicking(true);
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        openGroupPromptForSelected();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    comparePicking,
    compareA,
    compareB,
    focusMode,
    selectedId,
    selectedNode,
    multiSelectIds,
    helpOpen,
    searchOpen,
    contextMenu,
    groupPrompt,
    groupAskTarget,
    attentionObjectiveId,
    resolved,
    viewport.scale,
    nodes,
  ]);

  function applyPatch(patch: GraphPatch) {
    if (patch.kind === "addNodes") {
      setNodes((prev) => [...prev, ...patch.nodes]);
    } else if (patch.kind === "addEdges") {
      setEdges((prev) => [...prev, ...patch.edges]);
    } else if (patch.kind === "updateNode") {
      setNodes((prev) => prev.map((n) => (n.id === patch.id ? { ...n, ...patch.patch } : n)));
    }
  }

  function handleActivity(state: BrainState | null, detail: string | null) {
    setActivity(state ? { state, detail } : null);
  }

  // --- groups (real, persisted via /api/brain/groups) --------------------

  async function createGroup(memberIds: string[], name: string) {
    if (memberIds.length === 0 || !name.trim()) return;
    const res = await fetch("/api/brain/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), memberIds }),
    });
    if (res.ok) {
      const data = await res.json();
      setGroups((prev) => [data.group, ...prev]);
    }
  }

  async function addToGroup(groupId: string, memberIds: string[]) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const merged = [...new Set([...group.memberIds, ...memberIds])];
    const res = await fetch(`/api/brain/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: merged }),
    });
    if (res.ok) {
      const data = await res.json();
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data.group : g)));
    }
  }

  async function patchGroup(groupId: string, patch: { name?: string; collapsed?: boolean }) {
    const res = await fetch(`/api/brain/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data.group : g)));
    }
  }

  async function deleteGroup(groupId: string) {
    const res = await fetch(`/api/brain/groups/${groupId}`, { method: "DELETE" });
    if (res.ok) setGroups((prev) => prev.filter((g) => g.id !== groupId));
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
        setFocusMode(false);
        clearMultiSelect();
        setContextMenu(null);
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
    if (focusMode) return; // focus layout is deterministic; dragging is disabled while it's active
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

  function nodeLOD(node: BrainNode): NodeLOD {
    if (focusMode && node.id === selectedId) return "focus";
    if (viewport.scale < OVERVIEW_MAX) return "overview";
    return "explore";
  }

  const isGraphPerspective = perspective !== "ACTIVITY";
  const isComparing = Boolean(compareNodeA && compareNodeB);

  const focusedLabels = useMemo(() => {
    if (!selectedNode) return [];
    const names = [selectedNode.label];
    for (const id of neighborIds) {
      const n = nodes.find((x) => x.id === id);
      if (n) names.push(n.label);
    }
    return names.slice(0, 6);
  }, [selectedNode, neighborIds, nodes]);

  const pinnedNodes = useMemo(() => nodes.filter((n) => pinnedIds.has(n.id)), [nodes, pinnedIds]);
  const displayState = activity ?? brain;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => n.label.toLowerCase().includes(q) || String(n.meta.description ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [nodes, searchQuery]);

  const collapsedGroups = useMemo(() => groups.filter((g) => g.collapsed), [groups]);
  const collapsedMemberIds = useMemo(() => new Set(collapsedGroups.flatMap((g) => g.memberIds)), [collapsedGroups]);

  // Boundary boxes for expanded groups — computed from real member positions
  // in the currently visible perspective, so a group with no visible members
  // here simply doesn't draw a box rather than showing a stale/empty one.
  const groupBoxes = useMemo(() => {
    const GROUP_PAD = 60;
    return groups
      .filter((g) => !g.collapsed)
      .map((g) => {
        const pts = g.memberIds
          .filter((id) => filteredIds.has(id))
          .map((id) => displayPositions.get(id))
          .filter((p): p is Point => Boolean(p));
        if (pts.length === 0) return null;
        const minX = Math.min(...pts.map((p) => p.x)) - GROUP_PAD;
        const maxX = Math.max(...pts.map((p) => p.x)) + GROUP_PAD;
        const minY = Math.min(...pts.map((p) => p.y)) - GROUP_PAD - 22;
        const maxY = Math.max(...pts.map((p) => p.y)) + GROUP_PAD;
        return { group: g, minX, minY, width: maxX - minX, height: maxY - minY };
      })
      .filter((b): b is { group: BrainGroupDTO; minX: number; minY: number; width: number; height: number } => b !== null);
  }, [groups, filteredIds, displayPositions]);

  const collapsedGroupCards = useMemo(() => {
    return collapsedGroups
      .map((g) => {
        const pts = g.memberIds
          .filter((id) => filteredIds.has(id))
          .map((id) => displayPositions.get(id))
          .filter((p): p is Point => Boolean(p));
        if (pts.length === 0) return null;
        const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        return { group: g, x, y };
      })
      .filter((c): c is { group: BrainGroupDTO; x: number; y: number } => c !== null);
  }, [collapsedGroups, filteredIds, displayPositions]);

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
          {focusMode ? (
            <button type="button" onClick={exitFocus} className="text-xs text-muted-foreground hover:text-foreground">
              Exit focus
            </button>
          ) : null}
          {attentionObjectiveId ? (
            <button
              type="button"
              onClick={() => setAttentionObjectiveId(null)}
              className="rounded-full border border-accent/40 bg-accent-muted/40 px-2.5 py-0.5 text-xs text-accent hover:bg-accent-muted/60"
            >
              Attention mode · Exit
            </button>
          ) : null}
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5" title="Density — how much of the Brain is shown at once">
            {(["LOW", "MEDIUM", "HIGH"] as Density[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => changeDensity(d)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  density === d ? "bg-accent-muted text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d[0]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={openWhatMattersNow}
            className="rounded-full border border-accent/40 bg-accent-muted/30 px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-muted/50"
          >
            What matters now
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
            title="Search (/)"
          >
            🔍
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
          <BrainStateBadge state={displayState.state} detail={displayState.detail} />
        </div>
      </div>

      {pinnedNodes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 sm:px-4">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Pinned</span>
          {pinnedNodes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => selectNode(n)}
              className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
            >
              📌 {n.label}
            </button>
          ))}
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 sm:px-4">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Groups</span>
          {groups.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-[11px] text-muted-foreground"
            >
              <button type="button" onClick={() => patchGroup(g.id, { collapsed: !g.collapsed })} title={g.collapsed ? "Expand" : "Collapse"}>
                {g.collapsed ? "▸" : "▾"}
              </button>
              {renamingGroupId === g.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      patchGroup(g.id, { name: renameValue });
                      setRenamingGroupId(null);
                    } else if (e.key === "Escape") {
                      setRenamingGroupId(null);
                    }
                  }}
                  onBlur={() => setRenamingGroupId(null)}
                  className="w-24 border-b border-[var(--border-strong)] bg-transparent text-foreground outline-none"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => {
                    setRenamingGroupId(g.id);
                    setRenameValue(g.name);
                  }}
                  className="text-foreground"
                  title="Double-click to rename"
                >
                  {g.name} <span className="text-muted-foreground">({g.memberIds.length})</span>
                </button>
              )}
              <button type="button" onClick={() => setGroupAskTarget(g)} title="Ask VOX about this group">
                💬
              </button>
              <button type="button" onClick={() => deleteGroup(g.id)} title="Delete group (members are untouched)" className="text-muted hover:text-danger">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {comparePicking ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-accent-muted/40 px-3 py-1.5 text-xs text-accent sm:px-4">
          <span>Click another opportunity to compare with &quot;{selectedNode?.label}&quot;.</span>
          <button
            type="button"
            onClick={() => {
              setComparePicking(false);
              setCompareA(null);
            }}
            className="font-medium hover:underline"
          >
            Cancel (Esc)
          </button>
        </div>
      ) : null}

      {attentionObjectiveId && attentionBlockers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-muted/20 px-3 py-1.5 text-xs sm:px-4">
          <span className="font-medium text-accent">Needs attention:</span>
          {attentionBlockers.slice(0, 6).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                const target = nodes.find((n) => n.id === b.id);
                if (target) selectNode(target);
              }}
              className="rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
            >
              {b.label} <span className="text-muted">· {b.reason}</span>
            </button>
          ))}
        </div>
      ) : null}

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
                <EmptyState title={emptyTitle(perspective)} description={emptyDescription(perspective)} />
              </div>
            ) : (
              <div
                className="absolute left-0 top-0 transition-transform duration-500 ease-out"
                style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`, transformOrigin: "0 0" }}
              >
                <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }}>
                  {visibleEdges.map((edge) => {
                    const from = displayPositions.get(edge.from);
                    const to = displayPositions.get(edge.to);
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
                  {pullApartItems.length > 0 && selectedId && displayPositions.get(selectedId)
                    ? annotationConnectors(displayPositions.get(selectedId)!, pullApartItems, 165, "var(--core-thinking)")
                    : null}
                  {memoryAnnotations.length > 0 && selectedId && displayPositions.get(selectedId)
                    ? annotationConnectors(displayPositions.get(selectedId)!, memoryAnnotations, 190, "var(--core-listening)")
                    : null}
                </svg>
                {groupBoxes.map(({ group, minX, minY, width, height }) => (
                  <div
                    key={group.id}
                    className="pointer-events-none absolute rounded-2xl border border-dashed"
                    style={{
                      left: minX,
                      top: minY,
                      width,
                      height,
                      borderColor: group.color ?? "color-mix(in srgb, var(--accent) 45%, transparent)",
                      background: "color-mix(in srgb, var(--accent) 4%, transparent)",
                    }}
                  >
                    <span
                      className="absolute -top-2.5 left-3 rounded-full border border-border bg-[var(--surface-solid)] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      style={{ color: group.color ?? undefined }}
                    >
                      {group.name}
                    </span>
                  </div>
                ))}
                {filtered
                  .filter((node) => !collapsedMemberIds.has(node.id))
                  .map((node) => {
                    const p = displayPositions.get(node.id) ?? { x: 0, y: 0 };
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        x={p.x}
                        y={p.y}
                        selected={node.id === selectedId}
                        multiSelected={multiSelectIds.has(node.id)}
                        dimmed={
                          attentionIds
                            ? !attentionIds.has(node.id)
                            : focusMode
                              ? false
                              : selectedId != null && node.id !== selectedId && !neighborIds.has(node.id)
                        }
                        pinned={pinnedIds.has(node.id)}
                        lod={nodeLOD(node)}
                        relationshipCount={relationshipCounts.get(node.id) ?? 0}
                        onSelect={selectNode}
                        onFocusRequest={focusNode}
                        onPointerDownNode={onNodePointerDown}
                        onContextMenuRequest={(n, x, y) => setContextMenu({ node: n, x, y })}
                      />
                    );
                  })}
                {collapsedGroupCards.map(({ group, x, y }) => (
                  <div
                    key={group.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => patchGroup(group.id, { collapsed: false })}
                    className="absolute flex select-none flex-col items-center justify-center rounded-xl border px-3 py-2 text-center shadow-lg backdrop-blur-md"
                    style={{
                      left: x,
                      top: y,
                      transform: "translate(-50%, -50%)",
                      borderColor: group.color ?? "var(--border-strong)",
                      background: "color-mix(in srgb, var(--surface-solid) 88%, transparent)",
                      cursor: "pointer",
                    }}
                    title="Collapsed group — click to expand"
                  >
                    <p className="text-xs font-medium text-foreground">▸ {group.name}</p>
                    <p className="text-[10px] text-muted-foreground">{group.memberIds.length} items</p>
                  </div>
                ))}
                {selectedId && displayPositions.get(selectedId) ? (
                  <>
                    <OrbitAnnotations center={displayPositions.get(selectedId)!} items={pullApartItems} radius={165} colorVar="var(--core-thinking)" />
                    <OrbitAnnotations center={displayPositions.get(selectedId)!} items={memoryAnnotations} radius={190} colorVar="var(--core-listening)" />
                  </>
                ) : null}
              </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[10px] text-muted">
              <p>
                {filtered.length} objects in view · drag to pan · pinch/scroll to zoom · double-click to focus
              </p>
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
            <ActivityTimeline events={events} nodes={nodes} onSelectNode={(id) => {
              const target = nodes.find((n) => n.id === id);
              if (target) goToNode(target);
            }} />
          </div>
        )}

        {/* Desktop inspector: side panel. Mobile: bottom sheet. */}
        {selectedNode || isComparing ? (
          <>
            <div
              data-testid="brain-inspector"
              className="hidden w-[340px] shrink-0 border-l border-border bg-[var(--surface-solid)]/90 backdrop-blur-md lg:block"
            >
              {isComparing && compareNodeA && compareNodeB ? (
                <CompareView
                  a={compareNodeA}
                  b={compareNodeB}
                  onClose={() => {
                    setCompareA(null);
                    setCompareB(null);
                  }}
                  onActivity={handleActivity}
                />
              ) : selectedNode ? (
                <InspectorPanel
                  node={selectedNode}
                  nodes={nodes}
                  edges={edges}
                  events={events}
                  perspectiveLabel={perspectiveLabel(perspective)}
                  focusedLabels={focusedLabels}
                  isPinned={pinnedIds.has(selectedNode.id)}
                  canCompare={nodes.some((n) => n.type === "OPPORTUNITY" && n.id !== selectedNode.id)}
                  onClose={() => {
                    setSelectedId(null);
                    setFocusMode(false);
                  }}
                  onFocus={enterFocusForSelected}
                  onSelectNode={(id) => {
                    const target = nodes.find((n) => n.id === id);
                    if (target) selectNode(target);
                  }}
                  onGraphPatch={applyPatch}
                  onTogglePin={() => togglePin(selectedNode.id)}
                  onStartCompare={() => {
                    setCompareA(selectedNode.id);
                    setComparePicking(true);
                  }}
                  onActivity={handleActivity}
                  onMemoryAnnotations={(memories: MemoryAnnotation[]) =>
                    setMemoryAnnotations(memories.map((m) => ({ id: m.id, label: "Memory", value: m.content })))
                  }
                  onToggleAttention={selectedNode.type === "OBJECTIVE" ? () => toggleAttention(selectedNode.entityId) : undefined}
                  attentionActive={attentionObjectiveId === selectedNode.entityId}
                />
              ) : null}
            </div>

            {mobileSheetOpen ? (
              <div
                data-testid="brain-inspector"
                className="fixed inset-x-0 bottom-16 z-40 max-h-[calc(75vh-4rem)] rounded-t-2xl border-t border-border bg-[var(--surface-solid)] shadow-2xl lg:hidden"
              >
                <div className="flex justify-center pb-1 pt-2">
                  <span className="h-1 w-10 rounded-full bg-border" />
                </div>
                {isComparing && compareNodeA && compareNodeB ? (
                  <CompareView
                    a={compareNodeA}
                    b={compareNodeB}
                    onClose={() => {
                      setCompareA(null);
                      setCompareB(null);
                    }}
                    onActivity={handleActivity}
                  />
                ) : selectedNode ? (
                  <InspectorPanel
                    node={selectedNode}
                    nodes={nodes}
                    edges={edges}
                    events={events}
                    perspectiveLabel={perspectiveLabel(perspective)}
                    focusedLabels={focusedLabels}
                    isPinned={pinnedIds.has(selectedNode.id)}
                    canCompare={nodes.some((n) => n.type === "OPPORTUNITY" && n.id !== selectedNode.id)}
                    onClose={() => {
                      setSelectedId(null);
                      setFocusMode(false);
                      setMobileSheetOpen(false);
                    }}
                    onFocus={enterFocusForSelected}
                    onSelectNode={(id) => {
                      const target = nodes.find((n) => n.id === id);
                      if (target) selectNode(target);
                    }}
                    onGraphPatch={applyPatch}
                    onTogglePin={() => togglePin(selectedNode.id)}
                    onStartCompare={() => {
                      setCompareA(selectedNode.id);
                      setComparePicking(true);
                    }}
                    onActivity={handleActivity}
                    onMemoryAnnotations={(memories: MemoryAnnotation[]) =>
                      setMemoryAnnotations(memories.map((m) => ({ id: m.id, label: "Memory", value: m.content })))
                    }
                    onToggleAttention={selectedNode.type === "OBJECTIVE" ? () => toggleAttention(selectedNode.entityId) : undefined}
                    attentionActive={attentionObjectiveId === selectedNode.entityId}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {contextMenu ? (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => e.preventDefault()} />
          <div
            className="fixed z-50 flex w-48 flex-col rounded-xl border border-border bg-[var(--surface-solid)] py-1.5 text-xs shadow-2xl backdrop-blur-md"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <p className="truncate px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {contextMenu.node.label}
            </p>
            <ContextMenuItem
              onClick={() => {
                focusNode(contextMenu.node);
                setContextMenu(null);
              }}
            >
              Focus
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                togglePin(contextMenu.node.id);
                setContextMenu(null);
              }}
            >
              {pinnedIds.has(contextMenu.node.id) ? "Unpin" : "Pin"}
            </ContextMenuItem>
            {contextMenu.node.type === "OPPORTUNITY" && nodes.some((n) => n.type === "OPPORTUNITY" && n.id !== contextMenu.node.id) ? (
              <ContextMenuItem
                onClick={() => {
                  setCompareA(contextMenu.node.id);
                  setComparePicking(true);
                  setContextMenu(null);
                }}
              >
                Compare
              </ContextMenuItem>
            ) : null}
            {contextMenu.node.type === "OBJECTIVE" ? (
              <ContextMenuItem
                onClick={() => {
                  toggleAttention(contextMenu.node.entityId);
                  setContextMenu(null);
                }}
              >
                {attentionObjectiveId === contextMenu.node.entityId ? "Exit attention" : "Attention"}
              </ContextMenuItem>
            ) : null}
            <div className="my-1 border-t border-border" />
            <ContextMenuItem
              onClick={() => {
                const ids = multiSelectIds.size > 0 ? [...multiSelectIds] : [contextMenu.node.id];
                setGroupPrompt({ memberIds: ids, name: ids.length === 1 ? contextMenu.node.label : `Group of ${ids.length}` });
                setContextMenu(null);
              }}
            >
              Group into new…
            </ContextMenuItem>
            {groups.map((g) => (
              <ContextMenuItem
                key={g.id}
                onClick={() => {
                  const ids = multiSelectIds.size > 0 ? [...multiSelectIds] : [contextMenu.node.id];
                  addToGroup(g.id, ids);
                  setContextMenu(null);
                }}
              >
                Add to &quot;{g.name}&quot;
              </ContextMenuItem>
            ))}
          </div>
        </>
      ) : null}

      {searchOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={() => setSearchOpen(false)}>
          <div
            className="flex max-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-[var(--surface-solid)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults[0]) goToNode(searchResults[0]);
              }}
              placeholder="Search the Brain — objectives, opportunities, tasks, memories…"
              className="border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <div className="overflow-y-auto scrollbar-thin">
              {searchQuery.trim() && searchResults.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted">Nothing in the Brain matches &quot;{searchQuery}&quot;.</p>
              ) : (
                searchResults.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => goToNode(n)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs hover:bg-accent-muted/30"
                  >
                    <span className="truncate text-foreground">{n.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{n.type.toLowerCase()}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {groupPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setGroupPrompt(null)}>
          <div
            className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-[var(--surface-solid)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">
              New group ({groupPrompt.memberIds.length} item{groupPrompt.memberIds.length === 1 ? "" : "s"})
            </p>
            <input
              autoFocus
              value={groupPrompt.name}
              onChange={(e) => setGroupPrompt((p) => (p ? { ...p, name: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  createGroup(groupPrompt.memberIds, groupPrompt.name);
                  setGroupPrompt(null);
                  clearMultiSelect();
                } else if (e.key === "Escape") {
                  setGroupPrompt(null);
                }
              }}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setGroupPrompt(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  createGroup(groupPrompt.memberIds, groupPrompt.name);
                  setGroupPrompt(null);
                  clearMultiSelect();
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast,#fff)]"
              >
                Create group
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {groupAskTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setGroupAskTarget(null)}>
          <div
            className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-[var(--surface-solid)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Ask VOX about &quot;{groupAskTarget.name}&quot;</p>
              <button type="button" onClick={() => setGroupAskTarget(null)} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>
            <AskVoxPanel
              contextText={buildGroupContextText(groupAskTarget, nodes)}
              contextLabel={groupAskTarget.name}
              visualContext={`Brain group "${groupAskTarget.name}" with ${groupAskTarget.memberIds.length} member(s).`}
              onActivity={handleActivity}
            />
          </div>
        </div>
      ) : null}

      {matterOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setMatterOpen(false)}>
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto scrollbar-thin rounded-2xl border border-border bg-[var(--surface-solid)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">What matters now</p>
              <button type="button" onClick={() => setMatterOpen(false)} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>
            {!whatMattersNow ? (
              <p className="text-xs text-muted">No objective set yet — create one to see what matters.</p>
            ) : (
              <div className="flex flex-col gap-3 text-xs">
                <p className="text-muted-foreground">
                  For objective <span className="text-foreground">&quot;{whatMattersNow.objective.label}&quot;</span>
                </p>

                <MatterSection title="Next best action">
                  {whatMattersNow.nextBestAction ? (
                    <MatterRow
                      label={whatMattersNow.nextBestAction.label}
                      reason={
                        whatMattersNow.nextBestAction.meta.nextAction
                          ? String(whatMattersNow.nextBestAction.meta.nextAction)
                          : "highest-ranked opportunity"
                      }
                      onClick={() => {
                        const target = whatMattersNow.nextBestAction!;
                        selectNode(target);
                        setMatterOpen(false);
                      }}
                    />
                  ) : (
                    <p className="text-muted">No ranked opportunity yet.</p>
                  )}
                </MatterSection>

                <MatterSection title={`Blockers (${whatMattersNow.blockers.length})`}>
                  {whatMattersNow.blockers.length === 0 ? (
                    <p className="text-muted">Nothing blocking this objective right now.</p>
                  ) : (
                    whatMattersNow.blockers.map((b) => (
                      <MatterRow
                        key={b.id}
                        label={b.label}
                        reason={b.reason}
                        onClick={() => {
                          const target = nodes.find((n) => n.id === b.id);
                          if (target) selectNode(target);
                          setMatterOpen(false);
                        }}
                      />
                    ))
                  )}
                </MatterSection>

                <MatterSection title={`Unfinished high-priority tasks (${whatMattersNow.highPriorityTasks.length})`}>
                  {whatMattersNow.highPriorityTasks.length === 0 ? (
                    <p className="text-muted">None recorded.</p>
                  ) : (
                    whatMattersNow.highPriorityTasks.map((t) => (
                      <MatterRow
                        key={t.id}
                        label={t.label}
                        reason={t.status?.toLowerCase().replace(/_/g, " ") ?? ""}
                        onClick={() => {
                          selectNode(t);
                          setMatterOpen(false);
                        }}
                      />
                    ))
                  )}
                </MatterSection>

                <MatterSection title={`Proposals awaiting review (${whatMattersNow.pendingProposals.length})`}>
                  {whatMattersNow.pendingProposals.length === 0 ? (
                    <p className="text-muted">None right now.</p>
                  ) : (
                    whatMattersNow.pendingProposals.map((p) => (
                      <MatterRow
                        key={p.id}
                        label={p.label}
                        reason="proposed"
                        onClick={() => {
                          selectNode(p);
                          setMatterOpen(false);
                        }}
                      />
                    ))
                  )}
                </MatterSection>

                <p className="text-muted">
                  The Brain is now in Attention mode for this objective — everything unrelated is subdued.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHelpOpen(false)}>
          <div
            className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-[var(--surface-solid)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Keyboard shortcuts</p>
              <button type="button" onClick={() => setHelpOpen(false)} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              {SHORTCUTS.map(([key, desc]) => (
                <Fragment key={key}>
                  <span className="justify-self-start rounded border border-border px-1.5 py-0.5 font-mono text-foreground">{key}</span>
                  <span className="text-muted-foreground">{desc}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MatterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function MatterRow({ label, reason, onClick }: { label: string; reason: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left hover:border-[var(--border-strong)]"
    >
      <span className="truncate text-foreground">{label}</span>
      <span className="shrink-0 text-muted-foreground">{reason}</span>
    </button>
  );
}

function ContextMenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-3 py-1.5 text-left text-foreground hover:bg-accent-muted/30">
      {children}
    </button>
  );
}

function buildGroupContextText(group: BrainGroupDTO, nodes: BrainNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const members = group.memberIds
    .map((id) => byId.get(id))
    .filter((n): n is BrainNode => Boolean(n))
    .map((n) => `${n.type.toLowerCase()} "${n.label}"${n.status ? ` (status: ${n.status})` : ""}`);
  return `Group "${group.name}"${group.description ? ` — ${group.description}` : ""}. Members: ${
    members.length > 0 ? members.join("; ") : "none currently loaded"
  }.`;
}

const SHORTCUTS: [string, string][] = [
  ["Click", "Select"],
  ["Double-click", "Focus / reorganize around selection"],
  ["Shift+Click", "Multi-select"],
  ["Right-click", "Context menu"],
  ["Drag node", "Move (persists)"],
  ["Drag empty space", "Pan"],
  ["Scroll / Pinch", "Zoom"],
  ["Esc", "Close panel / cancel / go back"],
  ["Space", "Center selected object"],
  ["F", "Focus selected object"],
  ["Enter", "Open / focus selected object"],
  ["/", "Open Brain search"],
  ["C", "Compare (opportunities)"],
  ["G", "Create group from selection"],
  ["?", "Toggle this help"],
];

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
