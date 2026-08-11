"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea, Label } from "@/components/ui/Field";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils/cn";

interface WithId {
  id: string;
  createdAt: string;
}
interface TaskItem extends WithId {
  title: string;
  status: string;
  priority: string;
  difficulty?: string | null;
  estimatedMinutes?: number | null;
  pros?: string[];
  cons?: string[];
}
interface GoalItem extends WithId {
  title: string;
  status: string;
}
interface DecisionItem extends WithId {
  title: string;
  status: string;
}
interface IdeaItem extends WithId {
  title: string;
  status: string;
}
interface ExperimentItem extends WithId {
  hypothesis: string;
  status: string;
}

const TABS = ["Tasks", "Goals", "Decisions", "Ideas", "Experiments"] as const;
type Tab = (typeof TABS)[number];

export function ProjectDetailClient({
  projectId,
  tasks: initialTasks,
  goals: initialGoals,
  decisions: initialDecisions,
  ideas: initialIdeas,
  experiments: initialExperiments,
}: {
  projectId: string;
  tasks: TaskItem[];
  goals: GoalItem[];
  decisions: DecisionItem[];
  ideas: IdeaItem[];
  experiments: ExperimentItem[];
}) {
  const [tab, setTab] = useState<Tab>("Tasks");
  const [tasks, setTasks] = useState(initialTasks);
  const [goals, setGoals] = useState(initialGoals);
  const [decisions, setDecisions] = useState(initialDecisions);
  const [ideas, setIdeas] = useState(initialIdeas);
  const [experiments, setExperiments] = useState(initialExperiments);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ difficulty: "", estimatedMinutes: "", pros: "", cons: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  function openTaskDetails(task: TaskItem) {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.id);
    setDetailDraft({
      difficulty: task.difficulty ?? "",
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : "",
      pros: (task.pros ?? []).join("\n"),
      cons: (task.cons ?? []).join("\n"),
    });
  }

  async function saveTaskDetails(id: string) {
    setSavingDetails(true);
    const payload = {
      difficulty: detailDraft.difficulty || null,
      estimatedMinutes: detailDraft.estimatedMinutes ? Number(detailDraft.estimatedMinutes) : null,
      pros: detailDraft.pros
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      cons: detailDraft.cons
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSavingDetails(false);
    if (res.ok) {
      const data = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data.task } : t)));
      setExpandedTaskId(null);
    }
  }

  async function addTask() {
    if (!draft.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: draft }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setTasks((prev) => [{ ...data.task, createdAt: data.task.createdAt }, ...prev]);
      setDraft("");
    }
  }

  async function toggleTask(task: TaskItem) {
    const nextStatus = task.status === "DONE" ? "TODO" : "DONE";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
  }

  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  async function addSimple(kind: "goals" | "decisions" | "ideas" | "experiments") {
    if (!draft.trim()) return;
    setBusy(true);
    const endpoint = `/api/${kind}`;
    const payload =
      kind === "experiments"
        ? { projectId, hypothesis: draft }
        : { projectId, title: draft };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      const item = data.goal ?? data.decision ?? data.idea ?? data.experiment;
      if (kind === "goals") setGoals((prev) => [item, ...prev]);
      if (kind === "decisions") setDecisions((prev) => [item, ...prev]);
      if (kind === "ideas") setIdeas((prev) => [item, ...prev]);
      if (kind === "experiments") setExperiments((prev) => [item, ...prev]);
      setDraft("");
    }
  }

  return (
    <div className="mt-6">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setDraft("");
            }}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Card>
          <CardContent className="flex gap-2 pt-4">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={tab === "Experiments" ? "Hypothesis to test..." : `New ${tab.slice(0, -1).toLowerCase()}...`}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (tab === "Tasks") addTask();
                else addSimple(tab.toLowerCase() as "goals" | "decisions" | "ideas" | "experiments");
              }}
            />
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() =>
                tab === "Tasks" ? addTask() : addSimple(tab.toLowerCase() as "goals" | "decisions" | "ideas" | "experiments")
              }
            >
              Add
            </Button>
          </CardContent>
        </Card>

        <div className="mt-4">
          {tab === "Tasks" &&
            (tasks.length === 0 ? (
              <EmptyState title="No tasks yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggleTask(t)} />
                      <span className={cn("flex-1 text-sm text-foreground", t.status === "DONE" && "line-through text-muted")}>
                        {t.title}
                      </span>
                      <Badge tone={t.priority === "HIGH" ? "danger" : t.priority === "MEDIUM" ? "warning" : "neutral"}>
                        {t.priority.toLowerCase()}
                      </Badge>
                      {t.difficulty ? <Badge>{t.difficulty.toLowerCase()}</Badge> : null}
                      <Button size="sm" variant="ghost" onClick={() => openTaskDetails(t)}>
                        {expandedTaskId === t.id ? "Close" : "Details"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteTask(t.id)}>
                        Delete
                      </Button>
                    </div>

                    {expandedTaskId === t.id ? (
                      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                        <p className="text-xs text-muted">
                          These feed VOX Brain — the neuron for this task shows exactly what&apos;s filled in here, nothing
                          guessed.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <Label>Difficulty</Label>
                            <Select
                              value={detailDraft.difficulty}
                              onChange={(e) => setDetailDraft((d) => ({ ...d, difficulty: e.target.value }))}
                            >
                              <option value="">Not set</option>
                              <option value="EASY">Easy</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HARD">Hard</option>
                            </Select>
                          </div>
                          <div>
                            <Label>Estimated time (minutes)</Label>
                            <Input
                              type="number"
                              min={1}
                              value={detailDraft.estimatedMinutes}
                              onChange={(e) => setDetailDraft((d) => ({ ...d, estimatedMinutes: e.target.value }))}
                              placeholder="e.g. 90"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <Label>Pros (one per line)</Label>
                            <Textarea
                              rows={3}
                              value={detailDraft.pros}
                              onChange={(e) => setDetailDraft((d) => ({ ...d, pros: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Cons (one per line)</Label>
                            <Textarea
                              rows={3}
                              value={detailDraft.cons}
                              onChange={(e) => setDetailDraft((d) => ({ ...d, cons: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div>
                          <Button size="sm" disabled={savingDetails} onClick={() => saveTaskDetails(t.id)}>
                            Save details
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Goals" &&
            (goals.length === 0 ? (
              <EmptyState title="No goals yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <span className="text-foreground">{g.title}</span>
                    <Badge>{g.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Decisions" &&
            (decisions.length === 0 ? (
              <EmptyState title="No decisions logged yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {decisions.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <span className="text-foreground">{d.title}</span>
                    <Badge>{d.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Ideas" &&
            (ideas.length === 0 ? (
              <EmptyState title="No ideas captured yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {ideas.map((i) => (
                  <li key={i.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <span className="text-foreground">{i.title}</span>
                    <Badge>{i.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Experiments" &&
            (experiments.length === 0 ? (
              <EmptyState title="No experiments yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {experiments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <span className="text-foreground">{e.hypothesis}</span>
                    <Badge>{e.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}
