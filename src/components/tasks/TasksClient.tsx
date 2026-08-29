"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea, Label } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils/cn";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  difficulty: string | null;
  estimatedMinutes: number | null;
  pros: string[];
  cons: string[];
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
}
interface ProjectOption {
  id: string;
  name: string;
}

export function TasksClient({ tasks: initialTasks, projects }: { tasks: TaskItem[]; projects: ProjectOption[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ difficulty: "", estimatedMinutes: "", pros: "", cons: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  const openTasks = tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  const doneTasks = tasks.filter((t) => t.status === "DONE");

  async function addTask() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: projectId || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      const project = projects.find((p) => p.id === data.task.projectId);
      setTasks((prev) => [
        {
          id: data.task.id,
          title: data.task.title,
          status: data.task.status,
          priority: data.task.priority,
          difficulty: data.task.difficulty ?? null,
          estimatedMinutes: data.task.estimatedMinutes ?? null,
          pros: data.task.pros ?? [],
          cons: data.task.cons ?? [],
          projectId: data.task.projectId,
          projectName: project?.name ?? null,
          createdAt: data.task.createdAt,
        },
        ...prev,
      ]);
      setTitle("");
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

  function openTaskDetails(task: TaskItem) {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.id);
    setDetailDraft({
      difficulty: task.difficulty ?? "",
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : "",
      pros: task.pros.join("\n"),
      cons: task.cons.join("\n"),
    });
  }

  async function saveTaskDetails(id: string) {
    setSavingDetails(true);
    const payload = {
      difficulty: detailDraft.difficulty || null,
      estimatedMinutes: detailDraft.estimatedMinutes ? Number(detailDraft.estimatedMinutes) : null,
      pros: detailDraft.pros.split("\n").map((s) => s.trim()).filter(Boolean),
      cons: detailDraft.cons.split("\n").map((s) => s.trim()).filter(Boolean),
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

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Open</p>
          <p className="vox-headline mt-1 text-2xl">{openTasks.length}</p>
        </div>
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Completed</p>
          <p className="vox-headline mt-1 text-2xl">{doneTasks.length}</p>
        </div>
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Total</p>
          <p className="vox-headline mt-1 text-2xl">{tasks.length}</p>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Add task</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task..."
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            className="flex-1"
          />
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="sm:w-48">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button disabled={busy || !title.trim()} onClick={addTask}>
            Add
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4">
        {tasks.length === 0 ? (
          <EmptyState title="No tasks yet" description="Add one above, or from a project's Tasks tab." />
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id} className="vox-lift instrument instrument-sheen rounded-[var(--radius-sm)] p-3">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggleTask(t)} />
                  <div className="flex-1">
                    <span className={cn("text-sm text-foreground", t.status === "DONE" && "line-through text-muted")}>
                      {t.title}
                    </span>
                    {t.projectName ? <span className="ml-2 text-xs text-muted">{t.projectName}</span> : null}
                  </div>
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
        )}
      </div>
    </div>
  );
}
