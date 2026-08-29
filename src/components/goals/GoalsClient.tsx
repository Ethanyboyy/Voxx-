"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface GoalItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
}
interface ProjectOption {
  id: string;
  name: string;
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  ACHIEVED: "success",
  ABANDONED: "neutral",
};

export function GoalsClient({ goals: initialGoals, projects }: { goals: GoalItem[]; projects: ProjectOption[] }) {
  const [goals, setGoals] = useState(initialGoals);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  const achieved = goals.filter((g) => g.status === "ACHIEVED").length;
  const active = goals.filter((g) => g.status === "ACTIVE").length;

  async function addGoal() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: projectId || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      const project = projects.find((p) => p.id === data.goal.projectId);
      setGoals((prev) => [
        {
          id: data.goal.id,
          title: data.goal.title,
          description: data.goal.description,
          status: data.goal.status,
          targetDate: data.goal.targetDate,
          projectId: data.goal.projectId,
          projectName: project?.name ?? null,
          createdAt: data.goal.createdAt,
        },
        ...prev,
      ]);
      setTitle("");
    }
  }

  async function setStatus(goal: GoalItem, status: string) {
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status } : g)));
    await fetch(`/api/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function deleteGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Total goals</p>
          <p className="vox-headline mt-1 text-2xl">{goals.length}</p>
        </div>
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Active</p>
          <p className="vox-headline mt-1 text-2xl">{active}</p>
        </div>
        <div className="instrument instrument-sheen px-4 py-3.5">
          <p className="vox-eyebrow">Achieved</p>
          <p className="vox-headline mt-1 text-2xl">
            {goals.length > 0 ? `${Math.round((achieved / goals.length) * 100)}%` : "—"}
          </p>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Add goal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New goal..."
            onKeyDown={(e) => e.key === "Enter" && addGoal()}
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
          <Button disabled={busy || !title.trim()} onClick={addGoal}>
            Add
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4">
        {goals.length === 0 ? (
          <EmptyState title="No goals yet" description="Add one above, or from a project's Goals tab." />
        ) : (
          <ul className="flex flex-col gap-2">
            {goals.map((g) => (
              <li
                key={g.id}
                className="vox-lift instrument instrument-sheen flex flex-col gap-2 rounded-[var(--radius-sm)] p-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <p className="text-sm text-foreground">{g.title}</p>
                  <p className="text-xs text-muted">
                    {g.projectName ? `${g.projectName} · ` : ""}
                    {g.targetDate ? `Target ${new Date(g.targetDate).toLocaleDateString()}` : "No target date"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={g.status}
                    onChange={(e) => setStatus(g, e.target.value)}
                    className="h-8 w-auto py-1 text-xs"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="ACHIEVED">Achieved</option>
                    <option value="ABANDONED">Abandoned</option>
                  </Select>
                  <Badge tone={STATUS_TONE[g.status] ?? "neutral"}>{g.status.toLowerCase()}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => deleteGoal(g.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
