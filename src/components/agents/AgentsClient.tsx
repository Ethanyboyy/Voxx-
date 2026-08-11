"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea, Select, Label } from "@/components/ui/Field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";
import { cn } from "@/lib/utils/cn";

type AgentRunStatus = "PLANNING" | "WAITING_FOR_PERMISSION" | "RUNNING" | "WAITING" | "FAILED" | "COMPLETED" | "CANCELLED";
type AgentStepStatus = "PENDING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "COMPLETED" | "FAILED" | "SKIPPED";

interface AgentStep {
  id: string;
  order: number;
  description: string;
  toolName: string | null;
  input: string | null;
  output: string | null;
  status: AgentStepStatus;
  capability: string | null;
  requiredLevel: string;
  error: string | null;
}

interface AgentRun {
  id: string;
  objective: string;
  status: AgentRunStatus;
  currentStep: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  steps: AgentStep[];
}

const RUN_STATUS_CORE: Record<AgentRunStatus, VoxCoreState> = {
  PLANNING: "thinking",
  RUNNING: "executing",
  WAITING_FOR_PERMISSION: "waiting",
  WAITING: "waiting",
  FAILED: "error",
  COMPLETED: "success",
  CANCELLED: "idle",
};

const RUN_STATUS_TONE: Record<AgentRunStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  PLANNING: "accent",
  RUNNING: "accent",
  WAITING_FOR_PERMISSION: "warning",
  WAITING: "warning",
  FAILED: "danger",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const STEP_STATUS_TONE: Record<AgentStepStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  RUNNING: "accent",
  WAITING_FOR_PERMISSION: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  SKIPPED: "neutral",
};

export function AgentsClient({
  initialRuns,
  projects,
}: {
  initialRuns: AgentRun[];
  projects: { id: string; name: string }[];
}) {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState(initialRuns);
  const [objective, setObjective] = useState("");
  const [projectId, setProjectId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detailed, setDetailed] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(() => searchParams.get("new") === "1");

  async function startRun() {
    const text = objective.trim();
    if (!text || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: text, projectId: projectId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start the run.");
        return;
      }
      setRuns((prev) => [data.run, ...prev]);
      setExpanded((prev) => ({ ...prev, [data.run.id]: true }));
      setObjective("");
      setFormOpen(false);
    } finally {
      setStarting(false);
    }
  }

  async function cancelRun(id: string) {
    const res = await fetch(`/api/agents/${id}/cancel`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setRuns((prev) => prev.map((r) => (r.id === id ? data.run : r)));
    }
  }

  async function grantAndResume(run: AgentRun, capability: string, requiredLevel: string) {
    const grantRes = await fetch("/api/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, level: requiredLevel }),
    });
    if (!grantRes.ok) return;
    const res = await fetch(`/api/agents/${run.id}/approve`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setRuns((prev) => prev.map((r) => (r.id === run.id ? data.run : r)));
    }
  }

  const blockingStep = (run: AgentRun) => run.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New agent run</CardTitle>
          {!formOpen ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              New run
            </Button>
          ) : null}
        </CardHeader>
        {formOpen ? (
          <CardContent>
            <Label htmlFor="objective">Objective</Label>
            <Textarea
              id="objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Capture an idea about the new onboarding flow and create a follow-up task"
              rows={3}
            />
            {projects.length > 0 ? (
              <div className="mt-3">
                <Label htmlFor="project">Project (optional)</Label>
                <Select id="project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex gap-2">
              <Button onClick={startRun} disabled={starting || !objective.trim()}>
                {starting ? "Planning…" : "Start"}
              </Button>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {runs.length === 0 ? (
        <EmptyState
          title="No agent runs yet"
          description="Start one above. VOX will plan a sequence of steps from its real tool registry — nothing fabricated."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => {
            const isOpen = expanded[run.id] ?? false;
            const isDetailed = detailed[run.id] ?? false;
            const blocked = blockingStep(run);
            return (
              <Card key={run.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left"
                  onClick={() => setExpanded((prev) => ({ ...prev, [run.id]: !isOpen }))}
                >
                  <VoxCore state={RUN_STATUS_CORE[run.status]} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{run.objective}</p>
                    <p className="text-xs text-muted">
                      {new Date(run.createdAt).toLocaleString()} · {run.steps.length} step
                      {run.steps.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge tone={RUN_STATUS_TONE[run.status]}>{run.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </button>

                {isOpen ? (
                  <CardContent>
                    {run.error ? <p className="mb-3 text-sm text-danger">{run.error}</p> : null}
                    {run.result ? <p className="mb-3 text-sm text-foreground">{run.result}</p> : null}

                    {blocked ? (
                      <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
                        <p className="text-sm font-medium text-foreground">
                          Waiting on permission: <code className="text-xs">{blocked.capability}</code> (requires{" "}
                          {blocked.requiredLevel})
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Step: {blocked.description}. Granting this runs the same permission check as everywhere
                          else in VOX — it is not bypassed for agent runs.
                        </p>
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => grantAndResume(run, blocked.capability!, blocked.requiredLevel)}
                        >
                          Grant &amp; resume
                        </Button>
                      </div>
                    ) : null}

                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Steps</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs font-medium text-accent"
                          onClick={() => setDetailed((prev) => ({ ...prev, [run.id]: !isDetailed }))}
                        >
                          {isDetailed ? "Simple view" : "Detailed view"}
                        </button>
                        {run.status === "RUNNING" || run.status === "WAITING_FOR_PERMISSION" || run.status === "PLANNING" ? (
                          <button type="button" className="text-xs font-medium text-danger" onClick={() => cancelRun(run.id)}>
                            Cancel run
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <ol className="flex flex-col gap-2">
                      {run.steps.map((step) => (
                        <li key={step.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("text-sm text-foreground", step.status === "SKIPPED" && "line-through text-muted")}>
                              {step.order + 1}. {step.description}
                            </span>
                            <Badge tone={STEP_STATUS_TONE[step.status]}>{step.status.replace(/_/g, " ").toLowerCase()}</Badge>
                          </div>
                          {isDetailed ? (
                            <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                              {step.toolName ? (
                                <span>
                                  tool: <code>{step.toolName}</code>
                                </span>
                              ) : null}
                              {step.capability ? (
                                <span>
                                  capability: <code>{step.capability}</code> (requires {step.requiredLevel})
                                </span>
                              ) : null}
                              {step.input ? <span>input: {step.input}</span> : null}
                              {step.output ? <span>output: {step.output}</span> : null}
                              {step.error ? <span className="text-danger">error: {step.error}</span> : null}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
