"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";

export interface SupervisorAgentStep {
  id: string;
  order: number;
  description: string;
  toolName: string | null;
  status: string;
  capability: string | null;
  requiredLevel: string;
  error: string | null;
}

export interface SupervisorAgentRunSummary {
  id: string;
  status: string;
  error: string | null;
  steps: SupervisorAgentStep[];
}

export interface SupervisorRunItem {
  id: string;
  objectiveId: string;
  status: string;
  iterations: number;
  maxIterations: number;
  result: string | null;
  error: string | null;
  /** JSON string — the planner's steps, shown for inspection while BLOCKED (MANUAL mode). */
  plan: string | null;
  createdAt: string;
  updatedAt: string;
  agentRuns: SupervisorAgentRunSummary[];
}

const STATUS_CORE: Record<string, VoxCoreState> = {
  PLANNING: "thinking",
  RUNNING: "executing",
  REPLANNING: "thinking",
  WAITING_FOR_APPROVAL: "waiting",
  BLOCKED: "waiting",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "idle",
};

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  PLANNING: "accent",
  RUNNING: "accent",
  REPLANNING: "accent",
  WAITING_FOR_APPROVAL: "warning",
  BLOCKED: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

/**
 * Lets VOX handle an objective autonomously: plan, select/create an agent,
 * execute, and stop only at a real approval boundary. Every action here
 * calls the real Supervisor API — nothing is simulated client-side.
 */
export function SupervisorPanel({
  objectiveId,
  runs,
  onRunsChange,
}: {
  objectiveId: string;
  runs: SupervisorRunItem[];
  onRunsChange: (updater: (prev: SupervisorRunItem[]) => SupervisorRunItem[]) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function startSupervisor() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/supervisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectiveId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start the supervisor.");
        return;
      }
      onRunsChange((prev) => [data.run, ...prev]);
    } finally {
      setStarting(false);
    }
  }

  /** Approve grants the real permission the blocked step needs (the exact
   * same checkCapability() gate as everywhere else in VOX), then resumes —
   * never bypasses the check, just authorizes it the same way a human
   * would from the Permissions page. */
  async function approve(id: string, capability: string, requiredLevel: string) {
    setBusyId(id);
    try {
      const grantRes = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability, level: requiredLevel }),
      });
      if (!grantRes.ok) return;
      const res = await fetch(`/api/supervisor/${id}/resume`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onRunsChange((prev) => prev.map((r) => (r.id === id ? data.run : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function decline(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/supervisor/${id}/decline`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onRunsChange((prev) => prev.map((r) => (r.id === id ? data.run : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  /** MANUAL autonomy's "Start execution" — runs exactly the plan already
   * shown, never re-plans. */
  async function begin(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/supervisor/${id}/begin`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onRunsChange((prev) => prev.map((r) => (r.id === id ? data.run : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/supervisor/${id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        onRunsChange((prev) => prev.map((r) => (r.id === id ? data.run : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  const active = runs.filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED" && r.status !== "CANCELLED");
  const finished = runs.filter((r) => r.status === "COMPLETED" || r.status === "FAILED" || r.status === "CANCELLED");

  return (
    <div className="mt-4 border-t border-border pt-4">
      {/* Stacked on phones — the label and the action button competing for
          one 390px row left both cramped. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="vox-eyebrow">Autonomous work (Supervisor)</p>
        <Button size="sm" onClick={startSupervisor} disabled={starting}>
          {starting ? "Understanding objective…" : "Let VOX handle this"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        VOX plans, selects or creates an agent by capability, and executes autonomously. It only stops for you at a
        real permission boundary — nothing here bypasses the capability/permission system.
      </p>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      {runs.length === 0 ? null : (
        <div className="mt-3 flex flex-col gap-2">
          {[...active, ...finished].map((run) => {
            const latestAgentRun = run.agentRuns[0];
            const blockedStep = latestAgentRun?.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
            return (
              <div key={run.id} className="vox-lift rounded-[var(--radius-sm)] border border-border p-3">
                <div className="flex items-center gap-2">
                  <VoxCore state={STATUS_CORE[run.status] ?? "idle"} size="sm" />
                  <span className="flex-1 text-xs text-muted">
                    {new Date(run.createdAt).toLocaleString()}
                    {run.iterations > 0 ? ` · replanned ${run.iterations}x` : ""}
                  </span>
                  <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </div>

                {run.result ? <p className="mt-2 text-sm text-foreground">{run.result}</p> : null}
                {run.error ? <p className="mt-2 text-sm text-danger">{run.error}</p> : null}

                {run.status === "BLOCKED" ? (
                  <div className="mt-3 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 p-3">
                    <p className="text-sm font-medium text-foreground">Plan ready — awaiting your go-ahead</p>
                    <p className="mt-1 text-xs text-muted">
                      MANUAL autonomy mode: VOX has planned this but will not execute anything until you say so.
                    </p>
                    {run.plan ? (
                      <ol className="mt-2 flex flex-col gap-1 text-xs text-muted">
                        {(JSON.parse(run.plan) as { description: string; toolName?: string | null }[]).map((step, i) => (
                          <li key={i}>
                            {i + 1}. {step.description}
                            {step.toolName ? (
                              <>
                                {" "}
                                via <code>{step.toolName}</code>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="mt-2">
                      <Button size="sm" onClick={() => begin(run.id)} disabled={busyId === run.id}>
                        Start execution
                      </Button>
                    </div>
                  </div>
                ) : null}

                {run.status === "WAITING_FOR_APPROVAL" && blockedStep ? (
                  <div className="mt-3 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 p-3">
                    <p className="text-sm font-medium text-foreground">Approval required</p>
                    <p className="mt-1 text-xs text-muted">
                      Action: <span className="text-foreground">{blockedStep.description}</span>
                      {blockedStep.toolName ? (
                        <>
                          {" "}
                          via <code>{blockedStep.toolName}</code>
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Requires capability <code className="text-xs">{blockedStep.capability}</code> at{" "}
                      {blockedStep.requiredLevel} — not currently granted.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => approve(run.id, blockedStep.capability!, blockedStep.requiredLevel)}
                        disabled={busyId === run.id}
                      >
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => decline(run.id)} disabled={busyId === run.id}>
                        Decline
                      </Button>
                    </div>
                  </div>
                ) : null}

                {run.status === "RUNNING" || run.status === "PLANNING" || run.status === "REPLANNING" || run.status === "BLOCKED" ? (
                  <div className="mt-2">
                    <Button size="sm" variant="ghost" onClick={() => cancel(run.id)} disabled={busyId === run.id}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
