"use client";

import { useEffect, useMemo, useState } from "react";
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
interface TaskNeuron {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  difficulty: string | null;
  estimatedMinutes: number | null;
  pros: string[];
  cons: string[];
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  projectName: string | null;
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
  | { kind: "task"; task: TaskNeuron }
  | { kind: "pattern"; pattern: PatternItem }
  | { kind: "connection"; connection: ConnectionSummary }
  | null;

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "var(--core-error)",
  MEDIUM: "var(--core-executing)",
  LOW: "var(--core-listening)",
};
const DIFFICULTY_RADIUS: Record<string, number> = {
  EASY: 5,
  MEDIUM: 6.5,
  HARD: 8.5,
};

function neuronColor(t: TaskNeuron): string {
  if (t.status === "DONE") return "var(--core-success)";
  return PRIORITY_COLOR[t.priority] ?? "var(--core-thinking)";
}

function neuronRadius(t: TaskNeuron): number {
  return t.difficulty ? DIFFICULTY_RADIUS[t.difficulty] ?? 6.5 : 6.5;
}

/** Deterministic pseudo-random in [0,1) from a string — stable neuron layout across re-renders without persisting coordinates. */
function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Honest, not fabricated: only shown when both an estimate and an actual
 * completion timestamp exist. Measured from creation to completion, so it
 * includes any idle time — that limitation is stated, not hidden.
 */
function efficiencyLabel(t: TaskNeuron): string | null {
  if (!t.completedAt || !t.estimatedMinutes) return null;
  const openMs = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime();
  const openMinutes = Math.max(1, Math.round(openMs / 60000));
  const pct = Math.round((t.estimatedMinutes / openMinutes) * 100);
  return `Open ${formatMinutes(openMinutes)} vs. an estimated ${formatMinutes(t.estimatedMinutes)} (${pct}% of estimate). Measured start-to-finish, so it includes idle time, not just active work.`;
}

export function VoxBrainClient({
  nodes,
  connections: edges,
  patterns,
  memoryStats,
  planning,
  execution,
  connectionsSummary,
  activity,
  tasks,
}: {
  nodes: KnowledgeNode[];
  connections: KnowledgeEdge[];
  patterns: PatternItem[];
  memoryStats: MemoryStats;
  planning: PlanningState;
  execution: ExecutionState;
  connectionsSummary: ConnectionSummary[];
  activity: ActivityItem[];
  tasks: TaskNeuron[];
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
        <BrainOverview
          tasks={tasks}
          nodeCount={nodes.length}
          edgeCount={edges.length}
          patterns={livePatterns}
          connectionsSummary={connectionsSummary}
          freshPatternIds={freshPatternIds}
        />
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

/**
 * Simplified anatomical brain silhouette (two hemispheres, central fissure,
 * cortex-fold hints, brainstem taper) in a 500x420 viewBox. Task "neurons"
 * are scattered deterministically inside it — each dot is a real Task, not
 * decoration; nothing here is generated per-render randomness.
 */
function BrainSilhouette() {
  return (
    <g fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.65}>
      <path d="M 250 55 C 275 30, 310 28, 335 45 C 365 40, 390 65, 388 95 C 415 105, 420 140, 400 160 C 418 175, 412 205, 388 215 C 398 240, 380 265, 353 265 C 358 288, 335 308, 310 298 C 305 318, 278 325, 258 308 C 250 320, 235 318, 228 305 C 215 290, 218 270, 228 258 C 210 248, 208 225, 222 210 C 208 198, 210 175, 226 163 C 215 145, 222 120, 242 108 C 235 90, 238 68, 250 55 Z" />
      <path d="M 250 55 C 225 30, 190 28, 165 45 C 135 40, 110 65, 112 95 C 85 105, 80 140, 100 160 C 82 175, 88 205, 112 215 C 102 240, 120 265, 147 265 C 142 288, 165 308, 190 298 C 195 318, 222 325, 242 308 C 250 320, 265 318, 272 305 C 285 290, 282 270, 272 258 C 290 248, 292 225, 278 210 C 292 198, 290 175, 274 163 C 285 145, 278 120, 258 108 C 265 90, 262 68, 250 55 Z" />
      <path d="M 250 55 C 248 100, 252 150, 250 200 C 248 240, 252 270, 250 308" strokeOpacity={0.55} />
      <path d="M 300 80 C 310 95, 308 115, 295 125 M 340 130 C 350 145, 345 165, 330 172 M 340 195 C 348 210, 340 228, 325 232 M 300 240 C 308 255, 298 270, 285 272" strokeOpacity={0.4} strokeWidth={1.4} />
      <path d="M 200 80 C 190 95, 192 115, 205 125 M 160 130 C 150 145, 155 165, 170 172 M 160 195 C 152 210, 160 228, 175 232 M 200 240 C 192 255, 202 270, 215 272" strokeOpacity={0.4} strokeWidth={1.4} />
      <path d="M 210 300 C 225 315, 275 315, 290 300" strokeOpacity={0.45} strokeWidth={1.4} />
      <path d="M 238 308 C 236 330, 240 348, 248 358 C 256 348, 260 330, 258 308" strokeOpacity={0.5} strokeWidth={1.4} />
    </g>
  );
}

function BrainOverview({
  tasks,
  nodeCount,
  edgeCount,
  patterns,
  connectionsSummary,
  freshPatternIds,
}: {
  tasks: TaskNeuron[];
  nodeCount: number;
  edgeCount: number;
  patterns: PatternItem[];
  connectionsSummary: ConnectionSummary[];
  freshPatternIds: Set<string>;
}) {
  const [selection, setSelection] = useState<GraphSelection>(null);
  const activeConnections = connectionsSummary.filter((c) => c.status !== "NOT_CONNECTED");
  const cx = 250;
  const cy = 175;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const t of tasks) {
      const angle = seedFrom(t.id) * Math.PI * 2;
      const radiusFrac = Math.sqrt(seedFrom(`${t.id}:r`));
      map.set(t.id, {
        x: cx + Math.cos(angle) * 148 * radiusFrac,
        y: cy + Math.sin(angle) * 118 * radiusFrac * 0.95 - 8,
      });
    }
    return map;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <GlassPanel className="relative overflow-hidden" style={{ height: 560 }}>
        <svg viewBox="0 0 500 420" className="h-full w-full">
          <defs>
            <filter id="neuron-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <BrainSilhouette />
          {tasks.length === 0 ? (
            <text x={cx} y={cy} textAnchor="middle" fontSize={13} fill="var(--muted)">
              No tasks yet
            </text>
          ) : (
            tasks.map((t) => {
              const pos = positions.get(t.id)!;
              const isSelected = selection?.kind === "task" && selection.task.id === t.id;
              const isActive = t.status === "IN_PROGRESS";
              const color = neuronColor(t);
              const r = neuronRadius(t) + (isSelected ? 2.5 : 0);
              return (
                <g
                  key={t.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelection({ kind: "task", task: t })}
                  filter="url(#neuron-glow)"
                >
                  {isSelected ? <circle r={r + 8} fill="none" stroke={color} strokeWidth={1} opacity={0.6} /> : null}
                  <circle r={r} fill={color} opacity={t.status === "DONE" ? 0.45 : 0.92}>
                    {isActive ? (
                      <animate attributeName="opacity" values="0.5;1;0.5" dur="2.2s" repeatCount="indefinite" />
                    ) : null}
                  </circle>
                </g>
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-muted">
          <Legend color="var(--core-error)" label="high priority" />
          <Legend color="var(--core-executing)" label="medium priority" />
          <Legend color="var(--core-listening)" label="low priority" />
          <Legend color="var(--core-success)" label="done" />
        </div>
        <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-muted">
          {nodeCount} knowledge entities · {edgeCount} links
        </p>
      </GlassPanel>

      <GlassPanel className="p-4">
        {!selection ? (
          <div>
            <EmptyState
              title="Click a neuron"
              description="Each glowing neuron is a real task. Click one to see what it is, how hard it is, how long it's estimated to take, and its tradeoffs."
            />
            {(patterns.length > 0 || activeConnections.length > 0) && (
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
                {patterns.length > 0 ? (
                  <button
                    type="button"
                    className="flex items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelection({ kind: "pattern", pattern: patterns[0]! })}
                  >
                    <span>Active patterns detected</span>
                    <Badge tone={freshPatternIds.size > 0 ? "warning" : "neutral"}>{patterns.length}</Badge>
                  </button>
                ) : null}
                {activeConnections.length > 0 ? (
                  <button
                    type="button"
                    className="flex items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelection({ kind: "connection", connection: activeConnections[0]! })}
                  >
                    <span>Active connections</span>
                    <Badge tone="success">{activeConnections.length}</Badge>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : selection.kind === "task" ? (
          <TaskDetail task={selection.task} />
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

function TaskDetail({ task }: { task: TaskNeuron }) {
  const efficiency = efficiencyLabel(task);
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
        <Badge tone={task.status === "DONE" ? "success" : task.priority === "HIGH" ? "danger" : "accent"}>
          {task.status.replace(/_/g, " ").toLowerCase()}
        </Badge>
      </div>
      {task.projectName ? <p className="mt-1 text-xs text-muted">{task.projectName}</p> : null}
      {task.description ? <p className="mt-2 text-sm text-muted">{task.description}</p> : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Priority</dt>
          <dd className="text-foreground">{task.priority.toLowerCase()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Difficulty</dt>
          <dd className="text-foreground">{task.difficulty ? task.difficulty.toLowerCase() : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Estimated time</dt>
          <dd className="text-foreground">{task.estimatedMinutes ? formatMinutes(task.estimatedMinutes) : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="text-foreground">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "Not set"}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted">
        {efficiency ?? "Efficiency: not enough data yet — set an estimated time, then complete the task, to see this."}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pros</p>
          {task.pros.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Not set</p>
          ) : (
            <ul className="mt-1 list-disc pl-4 text-xs text-foreground">
              {task.pros.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cons</p>
          {task.cons.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Not set</p>
          ) : (
            <ul className="mt-1 list-disc pl-4 text-xs text-foreground">
              {task.cons.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted">Set difficulty, an estimate, and pros/cons from the task&apos;s project page.</p>
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
