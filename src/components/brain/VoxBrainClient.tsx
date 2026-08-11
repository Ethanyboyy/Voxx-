"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { cn } from "@/lib/utils/cn";

interface KnowledgeNode {
  id: string;
  label: string;
  type: string;
  description: string | null;
  memoryId: string | null;
  projectId: string | null;
  goalId: string | null;
}
interface KnowledgeEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
}
interface PatternItem {
  id: string;
  type: string;
  description: string;
  status: string;
  occurrenceCount: number;
}
interface MemoryStats {
  total: number;
  byConfidence: Record<string, number>;
  byCategory: Record<string, number>;
  recent: { id: string; content: string; category: string; confidence: string }[];
}
interface PlanningState {
  activeProjects: { id: string; name: string }[];
  activeGoals: { id: string; title: string }[];
  openTasks: number;
  pendingDecisions: { id: string; title: string }[];
}
interface ExecutionState {
  agentRuns: { id: string; objective: string; status: string; stepCount: number }[];
}
interface ConnectionSummary {
  service: string;
  displayName: string;
  status: string;
}
interface ActivityItem {
  id: string;
  type: string;
  createdAt: string;
  consequential: boolean;
}

type Mode = "overview" | "memory" | "planning" | "execution" | "activity";
const MODES: { id: Mode; label: string }[] = [
  { id: "overview", label: "Brain" },
  { id: "memory", label: "Memory" },
  { id: "planning", label: "Planning" },
  { id: "execution", label: "Execution" },
  { id: "activity", label: "Activity" },
];

type GraphSelection =
  | { kind: "node"; node: KnowledgeNode }
  | { kind: "pattern"; pattern: PatternItem }
  | { kind: "connection"; connection: ConnectionSummary }
  | null;

const TYPE_COLOR: Record<string, string> = {
  PERSON: "var(--core-listening)",
  ORGANIZATION: "var(--core-executing)",
  PROJECT: "var(--core-responding)",
  GOAL: "var(--core-success)",
  CONCEPT: "var(--core-thinking)",
  TOPIC: "var(--accent-2)",
  ENTITY: "var(--muted)",
  OTHER: "var(--muted)",
};

export function VoxBrainClient({
  nodes,
  connections: edges,
  patterns,
  memoryStats,
  planning,
  execution,
  connectionsSummary,
  activity,
}: {
  nodes: KnowledgeNode[];
  connections: KnowledgeEdge[];
  patterns: PatternItem[];
  memoryStats: MemoryStats;
  planning: PlanningState;
  execution: ExecutionState;
  connectionsSummary: ConnectionSummary[];
  activity: ActivityItem[];
}) {
  const [mode, setMode] = useState<Mode>("overview");
  const [livePatterns, setLivePatterns] = useState(patterns);
  const [liveActivity, setLiveActivity] = useState(activity);
  const [freshPatternIds, setFreshPatternIds] = useState<Set<string>>(new Set());
  const [newActivityCount, setNewActivityCount] = useState(0);

  // Live activity polling — real data, not decorative: every 20s, pull the
  // latest patterns/events and highlight what's actually new since mount.
  useEffect(() => {
    const knownPatternIds = new Set(patterns.map((p) => p.id));
    const knownEventIds = new Set(activity.map((e) => e.id));

    const interval = setInterval(async () => {
      try {
        const [patternsRes, eventsRes] = await Promise.all([fetch("/api/patterns"), fetch("/api/events")]);
        const patternsData = await patternsRes.json();
        const eventsData = await eventsRes.json();
        const freshPatterns: PatternItem[] = (patternsData.patterns ?? []).filter((p: PatternItem) => p.status === "ACTIVE");
        const freshEvents: ActivityItem[] = eventsData.events ?? [];

        const newlyDetected = freshPatterns.filter((p) => !knownPatternIds.has(p.id));
        if (newlyDetected.length > 0) {
          for (const p of newlyDetected) knownPatternIds.add(p.id);
          setFreshPatternIds(new Set(newlyDetected.map((p) => p.id)));
          setTimeout(() => setFreshPatternIds(new Set()), 8000);
        }
        const newEvents = freshEvents.filter((e) => !knownEventIds.has(e.id));
        if (newEvents.length > 0) {
          for (const e of newEvents) knownEventIds.add(e.id);
          setNewActivityCount((c) => c + newEvents.length);
        }

        setLivePatterns(freshPatterns);
        setLiveActivity(freshEvents);
      } catch {
        // transient network hiccup — next tick tries again, no need to surface an error for a background poll
      }
    }, 20000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              if (m.id === "activity") setNewActivityCount(0);
            }}
            className={cn(
              "relative rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              mode === m.id
                ? "border-[var(--border-strong)] bg-accent-muted text-accent shadow-[0_0_16px_-6px_var(--accent)]"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
            {m.id === "activity" && newActivityCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                {newActivityCount > 9 ? "9+" : newActivityCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {mode === "overview" ? (
        <BrainGraph nodes={nodes} edges={edges} patterns={livePatterns} connectionsSummary={connectionsSummary} freshPatternIds={freshPatternIds} />
      ) : mode === "memory" ? (
        <MemoryMode stats={memoryStats} />
      ) : mode === "planning" ? (
        <PlanningMode planning={planning} />
      ) : mode === "execution" ? (
        <ExecutionMode execution={execution} />
      ) : (
        <ActivityMode activity={liveActivity} />
      )}
    </div>
  );
}

/* ---------------- Overview: the neural graph ---------------- */

function BrainGraph({
  nodes,
  edges,
  patterns,
  connectionsSummary,
  freshPatternIds,
}: {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  patterns: PatternItem[];
  connectionsSummary: ConnectionSummary[];
  freshPatternIds: Set<string>;
}) {
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const activeConnections = connectionsSummary.filter((c) => c.status !== "NOT_CONNECTED");
  const size = 720;
  const cx = size / 2;
  const cy = size / 2;

  const ring1 = useMemo(() => layoutRing(nodes.length, 240), [nodes.length]);
  const ring2 = useMemo(() => layoutRing(patterns.length, 330), [patterns.length]);
  const ring3 = useMemo(() => layoutRing(activeConnections.length, 400), [activeConnections.length]);

  const nodePos = new Map(nodes.map((n, i) => [n.id, ring1[i]!]));

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setView((v) => ({ ...v, scale: Math.min(2.4, Math.max(0.5, v.scale - e.deltaY * 0.001)) }));
  }
  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setView((v) => ({ ...v, tx: dragRef.current!.tx + dx, ty: dragRef.current!.ty + dy }));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <GlassPanel className="relative overflow-hidden" style={{ height: 560 }}>
        {nodes.length === 0 && patterns.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Nothing to map yet"
              description="The brain fills in as VOX accumulates knowledge entities, patterns, and connections."
            />
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${size} ${size}`}
              className="h-full w-full cursor-grab active:cursor-grabbing touch-none"
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
                {/* spokes from center */}
                {nodes.map((n, i) => (
                  <line
                    key={`spoke-${n.id}`}
                    x1={cx}
                    y1={cy}
                    x2={cx + ring1[i]!.x}
                    y2={cy + ring1[i]!.y}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                ))}
                {/* knowledge-graph edges */}
                {edges.map((edge) => {
                  const a = nodePos.get(edge.fromNodeId);
                  const b = nodePos.get(edge.toNodeId);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={edge.id}
                      x1={cx + a.x}
                      y1={cy + a.y}
                      x2={cx + b.x}
                      y2={cy + b.y}
                      stroke="var(--accent-blue)"
                      strokeOpacity={0.45}
                      strokeWidth={1.4}
                    />
                  );
                })}

                {/* center: VOX */}
                <circle cx={cx} cy={cy} r={34} fill="var(--accent)" opacity={0.18} style={{ filter: "blur(10px)" }} />
                <circle cx={cx} cy={cy} r={20} fill="var(--accent)" />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--accent-foreground)">
                  VOX
                </text>

                {/* ring 1: knowledge nodes */}
                {nodes.map((n, i) => {
                  const p = ring1[i]!;
                  const color = TYPE_COLOR[n.type] ?? "var(--muted)";
                  const isSelected = selection?.kind === "node" && selection.node.id === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${cx + p.x},${cy + p.y})`}
                      className="cursor-pointer"
                      onClick={() => setSelection({ kind: "node", node: n })}
                    >
                      <circle r={isSelected ? 12 : 9} fill={color} opacity={isSelected ? 1 : 0.85} />
                      {isSelected ? <circle r={18} fill="none" stroke={color} strokeWidth={1} opacity={0.5} /> : null}
                      <text
                        y={22}
                        textAnchor="middle"
                        fontSize={10}
                        fill="var(--muted-foreground)"
                        style={{ pointerEvents: "none" }}
                      >
                        {truncate(n.label, 14)}
                      </text>
                    </g>
                  );
                })}

                {/* ring 2: patterns (insights) */}
                {patterns.map((p, i) => {
                  const pos = ring2[i]!;
                  const isSelected = selection?.kind === "pattern" && selection.pattern.id === p.id;
                  const isFresh = freshPatternIds.has(p.id);
                  return (
                    <g
                      key={p.id}
                      transform={`translate(${cx + pos.x},${cy + pos.y})`}
                      className="cursor-pointer"
                      onClick={() => setSelection({ kind: "pattern", pattern: p })}
                    >
                      {isFresh ? (
                        <circle r={7} fill="none" stroke="var(--core-thinking)" strokeWidth={1.5}>
                          <animate attributeName="r" values="7;18;7" dur="1.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.8;0;0.8" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                      ) : null}
                      <circle r={isSelected ? 10 : 7} fill="var(--core-thinking)" opacity={0.9}>
                        <animate attributeName="opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite" />
                      </circle>
                      <text y={20} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)" style={{ pointerEvents: "none" }}>
                        {truncate(p.type.replace(/_/g, " ").toLowerCase(), 16)}
                      </text>
                    </g>
                  );
                })}

                {/* ring 3: active connections */}
                {activeConnections.map((c, i) => {
                  const pos = ring3[i]!;
                  const color = c.status === "CONNECTED" ? "var(--core-success)" : "var(--core-executing)";
                  const isSelected = selection?.kind === "connection" && selection.connection.service === c.service;
                  return (
                    <g
                      key={c.service}
                      transform={`translate(${cx + pos.x},${cy + pos.y})`}
                      className="cursor-pointer"
                      onClick={() => setSelection({ kind: "connection", connection: c })}
                    >
                      <circle r={isSelected ? 8 : 5.5} fill={color} opacity={0.9} />
                      <text y={17} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)" style={{ pointerEvents: "none" }}>
                        {truncate(c.displayName, 14)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 text-[10px] uppercase tracking-wide text-muted">
              <Legend color="var(--core-thinking)" label="knowledge" />
              <Legend color="var(--core-thinking)" pulse label="patterns" />
              <Legend color="var(--core-success)" label="connections" />
            </div>
            <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-muted">scroll to zoom · drag to pan</p>
          </>
        )}
      </GlassPanel>

      <GlassPanel className="p-4">
        {!selection ? (
          <EmptyState title="Select a node" description="Click anything in the graph to see what VOX knows about it." />
        ) : selection.kind === "node" ? (
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{selection.node.label}</h3>
              <Badge tone="accent">{selection.node.type.toLowerCase()}</Badge>
            </div>
            {selection.node.description ? <p className="mt-2 text-sm text-muted">{selection.node.description}</p> : null}
            {selection.node.memoryId ? <p className="mt-2 text-xs text-accent">linked memory</p> : null}
            {selection.node.projectId ? <p className="mt-1 text-xs text-accent">linked project</p> : null}
            {selection.node.goalId ? <p className="mt-1 text-xs text-accent">linked goal</p> : null}
          </div>
        ) : selection.kind === "pattern" ? (
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{selection.pattern.type.replace(/_/g, " ").toLowerCase()}</h3>
              <Badge tone="warning">{selection.pattern.status.toLowerCase()}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">{selection.pattern.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">Observed {selection.pattern.occurrenceCount}x</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{selection.connection.displayName}</h3>
              <Badge tone={selection.connection.status === "CONNECTED" ? "success" : "warning"}>
                {selection.connection.status.toLowerCase().replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Managed from the Connections Hub.</p>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function Legend({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", pulse && "vox-status-dot")} style={{ background: color, color }} />
      {label}
    </span>
  );
}

function layoutRing(count: number, radius: number): { x: number; y: number }[] {
  if (count === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ---------------- Other modes: real-data summaries ---------------- */

function MemoryMode({ stats }: { stats: MemoryStats }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total memories</p>
        <p className="mt-1 text-3xl font-semibold text-foreground">{stats.total}</p>
        <div className="mt-4 flex flex-col gap-1.5">
          {Object.entries(stats.byConfidence).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{k.toLowerCase()}</span>
              <span className="text-foreground">{v}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">By category</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {Object.entries(stats.byCategory).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{k.toLowerCase()}</span>
              <span className="text-foreground">{v}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
      <GlassPanel className="p-5 md:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent</p>
        {stats.recent.length === 0 ? (
          <EmptyState title="No memories yet" />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {stats.recent.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="text-foreground">{m.content}</span>
                <Badge>{m.confidence.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}

function PlanningMode({ planning }: { planning: PlanningState }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Active projects</p>
        {planning.activeProjects.length === 0 ? (
          <EmptyState title="None active" />
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
            {planning.activeProjects.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        )}
      </GlassPanel>
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Active goals</p>
        {planning.activeGoals.length === 0 ? (
          <EmptyState title="None active" />
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
            {planning.activeGoals.map((g) => (
              <li key={g.id}>{g.title}</li>
            ))}
          </ul>
        )}
      </GlassPanel>
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Open tasks</p>
        <p className="mt-1 text-3xl font-semibold text-foreground">{planning.openTasks}</p>
      </GlassPanel>
      <GlassPanel className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pending decisions</p>
        {planning.pendingDecisions.length === 0 ? (
          <EmptyState title="Nothing pending" />
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
            {planning.pendingDecisions.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}

function ExecutionMode({ execution }: { execution: ExecutionState }) {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Agent runs</p>
      {execution.agentRuns.length === 0 ? (
        <EmptyState title="No agent runs yet" description="Start one from the Agents workspace." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {execution.agentRuns.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">{r.objective}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted">{r.stepCount} steps</span>
                <Badge tone={r.status === "FAILED" ? "danger" : r.status === "COMPLETED" ? "success" : "accent"}>
                  {r.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function ActivityMode({ activity }: { activity: ActivityItem[] }) {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent activity</p>
      {activity.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <ol className="mt-3 flex flex-col gap-2 border-l border-border pl-4">
          {activity.map((e) => (
            <li key={e.id} className="relative text-sm">
              <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <span className="text-foreground">{e.type}</span>
              {e.consequential ? (
                <Badge tone="warning" className="ml-2">
                  consequential
                </Badge>
              ) : null}
              <span className="ml-2 text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
