"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { AskVoxPanel } from "@/components/brain/AskVoxPanel";
import type { BrainNode, BrainEdge, BrainState } from "@/lib/brain/graph";

interface ActivityEvent {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

export type GraphPatch =
  | { kind: "addNodes"; nodes: BrainNode[] }
  | { kind: "addEdges"; edges: BrainEdge[] }
  | { kind: "updateNode"; id: string; patch: Partial<BrainNode> };

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  ACTIVE: "accent",
  COMPLETED: "success",
  DONE: "success",
  ACHIEVED: "success",
  REJECTED: "danger",
  ABANDONED: "neutral",
  CANCELLED: "neutral",
  PAUSED: "warning",
  EVALUATING: "warning",
  IDEA: "neutral",
  TODO: "neutral",
  IN_PROGRESS: "accent",
  PROPOSED: "warning",
};

function buildContextText(node: BrainNode, objectiveTitle: string | null, projectName: string | null): string {
  switch (node.type) {
    case "OBJECTIVE": {
      const target = node.meta.targetValue as number | null;
      const current = node.meta.currentValue as number | null;
      const unit = (node.meta.targetUnit as string | null) ?? "";
      return `Objective "${node.label}" (status: ${node.status}).${
        target != null ? ` Target: ${target} ${unit}. Recorded progress: ${current ?? 0} ${unit}.` : ""
      }${node.meta.strategy ? ` Strategy: ${node.meta.strategy}.` : " No strategy recorded yet."}`;
    }
    case "OPPORTUNITY": {
      const value = node.meta.estimatedValue as number | null;
      return `Opportunity "${node.label}" toward objective "${objectiveTitle ?? "unknown"}" (status: ${node.status}). ${
        value != null ? `Estimated value: ${value}. ` : ""
      }${node.meta.effort ? `Effort: ${node.meta.effort}. ` : ""}Confidence: ${node.meta.confidence}. ${
        node.meta.risk ? `Risk: ${node.meta.risk}. ` : ""
      }${node.meta.nextAction ? `Next action: ${node.meta.nextAction}.` : "No next action recorded yet."}`;
    }
    case "PROJECT":
      return `Project "${node.label}" (status: ${node.status}).${
        node.meta.description ? ` ${node.meta.description}` : ""
      }`;
    case "TASK":
      return `Task "${node.label}" in project "${projectName ?? "none"}" (status: ${node.status}, priority: ${node.meta.priority}).`;
    case "RESEARCH":
      return `Research result for query "${node.meta.query}" (provider: ${node.meta.provider}): ${node.meta.summary ?? node.label}.`;
    case "PROPOSAL":
      return `Proposal: "${node.label}" (status: ${node.status}). Observation: ${node.meta.observation}.`;
    case "CONNECTION":
      return `Connection "${node.label}" (status: ${node.status}).`;
    case "MEMORY":
      return `Memory: "${node.label}" (confidence: ${node.meta.confidence}).`;
    default:
      return node.label;
  }
}

export interface MemoryAnnotation {
  id: string;
  content: string;
  confidence: string;
}

export function InspectorPanel({
  node,
  nodes,
  edges,
  events,
  perspectiveLabel,
  focusedLabels,
  isPinned,
  canCompare,
  onClose,
  onFocus,
  onSelectNode,
  onGraphPatch,
  onTogglePin,
  onStartCompare,
  onActivity,
  onMemoryAnnotations,
}: {
  node: BrainNode;
  nodes: BrainNode[];
  edges: BrainEdge[];
  events: ActivityEvent[];
  perspectiveLabel: string;
  focusedLabels: string[];
  isPinned: boolean;
  canCompare: boolean;
  onClose: () => void;
  onFocus: () => void;
  onSelectNode: (nodeId: string) => void;
  onGraphPatch: (patch: GraphPatch) => void;
  onTogglePin: () => void;
  onStartCompare: () => void;
  onActivity: (state: BrainState | null, detail: string | null) => void;
  onMemoryAnnotations: (memories: MemoryAnnotation[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researchQuery, setResearchQuery] = useState(node.label);
  const [showResearchInput, setShowResearchInput] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [relevantMemories, setRelevantMemories] = useState<
    { id: string; content: string; confidence: string; similarity: number }[] | null
  >(null);

  const byNodeId = new Map(nodes.map((n) => [n.id, n]));
  const objective =
    node.type === "OPPORTUNITY" ? byNodeId.get(`OBJECTIVE:${node.meta.objectiveId}`) : undefined;
  const project =
    node.type === "PROJECT"
      ? node
      : (node.type === "OPPORTUNITY" || node.type === "TASK") && node.meta.projectId
        ? byNodeId.get(`PROJECT:${node.meta.projectId}`)
        : undefined;

  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.from === node.id) neighborIds.add(e.to);
    if (e.to === node.id) neighborIds.add(e.from);
  }
  const neighbors = [...neighborIds].map((id) => byNodeId.get(id)).filter((n): n is BrainNode => Boolean(n));

  const changeLog = events
    .filter((e) => e.subjectId === node.entityId)
    .slice(0, 6);

  async function runResearch() {
    if (!researchQuery.trim()) return;
    setBusy("research");
    setError(null);
    onActivity("researching", `Researching "${researchQuery}"`);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: researchQuery, opportunityId: node.entityId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Research failed." }));
        setError(body.error ?? "Research failed.");
        onActivity("error", body.error ?? "Research failed.");
        return;
      }
      const data = await res.json();
      const newNodes: BrainNode[] = data.items.map((r: { id: string; title: string | null; query: string; sourceUrl: string | null; summary: string | null; relevance: number | null; confidence: string; provider: string; opportunityId: string | null; createdAt: string }) => ({
        id: `RESEARCH:${r.id}`,
        entityId: r.id,
        type: "RESEARCH" as const,
        label: r.title ?? r.query,
        status: null,
        updatedAt: r.createdAt,
        meta: {
          query: r.query,
          sourceUrl: r.sourceUrl,
          summary: r.summary,
          relevance: r.relevance,
          confidence: r.confidence,
          provider: r.provider,
          opportunityId: r.opportunityId,
        },
      }));
      onGraphPatch({ kind: "addNodes", nodes: newNodes });
      onGraphPatch({
        kind: "addEdges",
        edges: newNodes.map((n, i) => ({ id: `new-research-edge-${Date.now()}-${i}`, from: node.id, to: n.id, relation: "evidenced_by" })),
      });
      setShowResearchInput(false);
      onActivity("learning", `${newNodes.length} new research result${newNodes.length === 1 ? "" : "s"}`);
      setTimeout(() => onActivity(null, null), 3500);
    } finally {
      setBusy(null);
    }
  }

  async function createProject() {
    setBusy("promote");
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${node.entityId}/promote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Couldn't create project." }));
        setError(body.error ?? "Couldn't create project.");
        return;
      }
      const data = await res.json();
      const projectNode: BrainNode = {
        id: `PROJECT:${data.project.id}`,
        entityId: data.project.id,
        type: "PROJECT",
        label: data.project.name,
        status: data.project.status,
        updatedAt: data.project.updatedAt,
        meta: { description: data.project.description, standalone: false },
      };
      onGraphPatch({ kind: "addNodes", nodes: [projectNode] });
      onGraphPatch({ kind: "addEdges", edges: [{ id: `new-promote-edge-${Date.now()}`, from: node.id, to: projectNode.id, relation: "promoted_to" }] });
      onGraphPatch({ kind: "updateNode", id: node.id, patch: { meta: { ...node.meta, projectId: data.project.id }, status: "ACTIVE" } });
    } finally {
      setBusy(null);
    }
  }

  async function createTask() {
    if (!newTaskTitle.trim() || !project) return;
    setBusy("task");
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle, projectId: project.entityId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Couldn't create task." }));
        setError(body.error ?? "Couldn't create task.");
        return;
      }
      const data = await res.json();
      const taskNode: BrainNode = {
        id: `TASK:${data.task.id}`,
        entityId: data.task.id,
        type: "TASK",
        label: data.task.title,
        status: data.task.status,
        updatedAt: data.task.updatedAt,
        meta: { priority: data.task.priority, projectId: data.task.projectId, description: data.task.description },
      };
      onGraphPatch({ kind: "addNodes", nodes: [taskNode] });
      onGraphPatch({ kind: "addEdges", edges: [{ id: `new-task-edge-${Date.now()}`, from: project.id, to: taskNode.id, relation: "contains" }] });
      setNewTaskTitle("");
      setShowTaskInput(false);
    } finally {
      setBusy(null);
    }
  }

  async function toggleTaskDone() {
    const nextStatus = node.status === "DONE" ? "TODO" : "DONE";
    setBusy("toggle");
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${node.entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        onGraphPatch({ kind: "updateNode", id: node.id, patch: { status: nextStatus } });
      }
    } finally {
      setBusy(null);
    }
  }

  async function markOpportunityCompleted() {
    setBusy("complete");
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${node.entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (res.ok) {
        onGraphPatch({ kind: "updateNode", id: node.id, patch: { status: "COMPLETED" } });
      }
    } finally {
      setBusy(null);
    }
  }

  async function retrieveContext() {
    setBusy("context");
    setError(null);
    onActivity("thinking", "Retrieving relevant memories");
    try {
      const query = `${node.label} ${node.meta.description ?? ""}`.trim();
      const res = await fetch(`/api/brain/context?query=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setRelevantMemories(data.memories);
        onMemoryAnnotations(data.memories);
        onActivity("learning", `${data.memories.length} relevant memor${data.memories.length === 1 ? "y" : "ies"} retrieved`);
        setTimeout(() => onActivity(null, null), 3500);
      }
    } finally {
      setBusy(null);
    }
  }

  const contextText = buildContextText(node, (objective?.label as string) ?? null, (project?.label as string) ?? null);
  const visualContext = `Brain perspective: ${perspectiveLabel}. Currently focused on: ${focusedLabels.join(", ") || node.label}.`;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{node.type.toLowerCase()}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">{node.label}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onTogglePin}
            className={pinButtonClass(isPinned)}
            title={isPinned ? "Unpin" : "Pin — stays visible across perspectives"}
            aria-pressed={isPinned}
          >
            📌
          </button>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      {node.status ? <Badge tone={STATUS_TONE[node.status] ?? "neutral"}>{node.status.toLowerCase().replace(/_/g, " ")}</Badge> : null}
      {node.meta.description ? <p className="text-xs text-muted">{node.meta.description as string}</p> : null}

      {/* type-specific detail */}
      {node.type === "OBJECTIVE" ? (
        <div className="flex flex-col gap-2 text-xs">
          {node.meta.targetValue != null ? (
            <div>
              <p className="text-muted-foreground">Target</p>
              <p className="text-foreground">
                {(node.meta.currentValue as number | null) ?? 0} / {node.meta.targetValue as number} {node.meta.targetUnit as string}
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-muted-foreground">Strategy</p>
            <p className="text-foreground">{(node.meta.strategy as string) || "Not recorded yet."}</p>
          </div>
          {((node.meta.assumptions as string[]) ?? []).length > 0 ? (
            <div>
              <p className="text-muted-foreground">Assumptions</p>
              <ul className="list-inside list-disc text-foreground">
                {(node.meta.assumptions as string[]).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {node.type === "OPPORTUNITY" ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Value" value={node.meta.estimatedValue != null ? String(node.meta.estimatedValue) : "Not set"} />
          <Field label="Effort" value={(node.meta.effort as string) ?? "Not set"} />
          <Field label="Confidence" value={node.meta.confidence as string} />
          <Field label="Risk" value={(node.meta.risk as string) ?? "Not set"} />
          <div className="col-span-2">
            <Field label="Next action" value={(node.meta.nextAction as string) || "Not set"} />
          </div>
        </div>
      ) : null}

      {node.type === "TASK" ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Priority" value={(node.meta.priority as string).toLowerCase()} />
          <Field label="Difficulty" value={((node.meta.difficulty as string) ?? "not set").toLowerCase()} />
        </div>
      ) : null}

      {node.type === "RESEARCH" ? (
        <div className="flex flex-col gap-2 text-xs">
          <Field label="Query" value={node.meta.query as string} />
          <Field
            label="Provider"
            value={node.meta.provider === "mock" ? "mock — no live source" : (node.meta.provider as string)}
          />
          {node.meta.summary ? <Field label="Finding" value={node.meta.summary as string} /> : null}
          {node.meta.sourceUrl ? (
            <a href={node.meta.sourceUrl as string} target="_blank" rel="noreferrer" className="text-accent">
              Open source →
            </a>
          ) : null}
        </div>
      ) : null}

      {/* relationships */}
      {neighbors.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Connected to</p>
          <div className="mt-1 flex flex-col gap-1">
            {neighbors.slice(0, 8).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n.id)}
                className="truncate text-left text-xs text-muted-foreground hover:text-accent"
              >
                {n.type.toLowerCase()} · {n.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* recorded change log — only real Events, never fabricated history */}
      {changeLog.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">History</p>
          <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
            {changeLog.map((e) => (
              <li key={e.id} className="text-xs text-muted-foreground">
                {e.type.replace(/[._]/g, " ")} · {new Date(e.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* contextual actions — only what actually applies to this type/state */}
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <Button size="sm" variant="secondary" onClick={onFocus}>
          Focus
        </Button>

        {node.type === "OPPORTUNITY" ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy === "research"} onClick={() => setShowResearchInput((s) => !s)}>
              Research
            </Button>
            {node.meta.projectId ? (
              <Link href="/projects" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                Open project
              </Link>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy === "promote"} onClick={createProject}>
                Create project
              </Button>
            )}
            {node.status !== "COMPLETED" ? (
              <Button size="sm" variant="ghost" disabled={busy === "complete"} onClick={markOpportunityCompleted}>
                Mark completed
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy === "context"} onClick={retrieveContext}>
              Retrieve context
            </Button>
            {canCompare ? (
              <Button size="sm" variant="ghost" onClick={onStartCompare}>
                Compare
              </Button>
            ) : null}
          </>
        ) : null}

        {node.type === "PROJECT" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setShowTaskInput((s) => !s)}>
              New task
            </Button>
            <Link href="/projects" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Open in Projects
            </Link>
          </>
        ) : null}

        {node.type === "TASK" ? (
          <Button size="sm" variant="ghost" disabled={busy === "toggle"} onClick={toggleTaskDone}>
            {node.status === "DONE" ? "Reopen" : "Mark done"}
          </Button>
        ) : null}

        {node.type === "OBJECTIVE" ? (
          <Link href="/objectives" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Open in Objectives
          </Link>
        ) : null}

        {node.type === "PROPOSAL" ? (
          <Link href="/proposals" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Open in Proposals
          </Link>
        ) : null}

        {node.type === "CONNECTION" ? (
          <Link href="/connections" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Open in Connections
          </Link>
        ) : null}

        {node.type === "MEMORY" ? (
          <Link href="/memory" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Open in Memory
          </Link>
        ) : null}
      </div>

      {showResearchInput ? (
        <div className="flex gap-1.5">
          <Input value={researchQuery} onChange={(e) => setResearchQuery(e.target.value)} className="text-xs" />
          <Button size="sm" disabled={busy === "research"} onClick={runResearch}>
            {busy === "research" ? "Researching…" : "Go"}
          </Button>
        </div>
      ) : null}

      {showTaskInput ? (
        <div className="flex gap-1.5">
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Task title"
            className="text-xs"
            onKeyDown={(e) => e.key === "Enter" && createTask()}
          />
          <Button size="sm" disabled={busy === "task"} onClick={createTask}>
            Add
          </Button>
        </div>
      ) : null}

      {relevantMemories ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Relevant memories</p>
          {relevantMemories.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Nothing relevant found in memory yet.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {relevantMemories.map((m) => (
                <li key={m.id} className="text-xs text-foreground">
                  {m.content} <span className="text-muted-foreground">({m.confidence.toLowerCase()})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="border-t border-border pt-3">
        <AskVoxPanel contextText={contextText} contextLabel={node.label} visualContext={visualContext} onActivity={onActivity} />
      </div>
    </div>
  );
}

function pinButtonClass(active: boolean): string {
  return active
    ? "flex h-6 w-6 items-center justify-center rounded-full bg-accent-muted text-xs"
    : "flex h-6 w-6 items-center justify-center rounded-full text-xs opacity-40 hover:opacity-100";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="truncate text-foreground">{value}</p>
    </div>
  );
}
