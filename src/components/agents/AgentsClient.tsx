"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea, Select, Label, Input } from "@/components/ui/Field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";
import { VoxErrorPanel } from "@/components/vox/VoxErrorPanel";
import { useEventStream } from "@/lib/events/useEventStream";
import type { LiveEvent } from "@/lib/events/bus";
import { cn } from "@/lib/utils/cn";

type AgentRunStatus = "PLANNING" | "WAITING_FOR_PERMISSION" | "RUNNING" | "WAITING" | "FAILED" | "COMPLETED" | "CANCELLED";
type AgentStepStatus = "PENDING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "COMPLETED" | "FAILED" | "SKIPPED";
type AgentStatus = "DRAFT" | "READY" | "ARCHIVED";

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
  agentId: string | null;
  status: AgentRunStatus;
  currentStep: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  steps: AgentStep[];
}

interface AgentDefinition {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  status: AgentStatus;
  allowedCapabilities: string[];
  createdAt: string;
  updatedAt: string;
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

const AGENT_STATUS_TONE: Record<AgentStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  READY: "success",
  ARCHIVED: "neutral",
};

export function AgentsClient({
  initialRuns,
  initialAgents,
  projects,
  capabilityOptions,
}: {
  initialRuns: AgentRun[];
  initialAgents: AgentDefinition[];
  projects: { id: string; name: string }[];
  capabilityOptions: string[];
}) {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState(initialRuns);
  const [agents, setAgents] = useState(initialAgents);
  const [objective, setObjective] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detailed, setDetailed] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(() => searchParams.get("new") === "1");

  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentInstructions, setAgentInstructions] = useState("");
  const [agentCapabilities, setAgentCapabilities] = useState<string[]>([]);
  const [savingAgent, setSavingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const refreshRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/agents/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setRuns((prev) => (prev.some((r) => r.id === id) ? prev.map((r) => (r.id === id ? data.run : r)) : [data.run, ...prev]));
  }, []);

  const refreshAgents = useCallback(async () => {
    const res = await fetch("/api/agent-definitions");
    if (!res.ok) return;
    const data = await res.json();
    setAgents(data.agents);
  }, []);

  const handleLiveEvent = useCallback(
    (event: LiveEvent) => {
      if (event.subjectType === "AgentRun" && event.subjectId) {
        void refreshRun(event.subjectId);
      } else if (event.subjectType === "Agent") {
        void refreshAgents();
      }
    },
    [refreshRun, refreshAgents]
  );
  const { status: liveStatus } = useEventStream({ onEvent: handleLiveEvent });

  async function startRun() {
    const text = objective.trim();
    if (!text || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: text, projectId: projectId || undefined, agentId: agentId || undefined }),
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

  function toggleNewAgentCapability(cap: string) {
    setAgentCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  }

  async function createAgentDefinition() {
    const name = agentName.trim();
    if (!name || savingAgent) return;
    setSavingAgent(true);
    setAgentError(null);
    try {
      const res = await fetch("/api/agent-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: agentDescription.trim() || undefined,
          instructions: agentInstructions.trim() || undefined,
          allowedCapabilities: agentCapabilities,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAgentError(data.error ?? "Could not create the agent.");
        return;
      }
      setAgents((prev) => [data.agent, ...prev]);
      setAgentName("");
      setAgentDescription("");
      setAgentInstructions("");
      setAgentCapabilities([]);
      setAgentFormOpen(false);
    } finally {
      setSavingAgent(false);
    }
  }

  async function setAgentStatus(id: string, status: AgentStatus) {
    const res = await fetch(`/api/agent-definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const data = await res.json();
      setAgents((prev) => prev.map((a) => (a.id === id ? data.agent : a)));
    }
  }

  async function deleteAgentDefinition(id: string) {
    const res = await fetch(`/api/agent-definitions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAgents((prev) => prev.filter((a) => a.id !== id));
      if (agentId === id) setAgentId("");
    }
  }

  const blockingStep = (run: AgentRun) => run.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
  const runnableAgents = agents.filter((a) => a.status !== "ARCHIVED");

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex justify-end">
        <StateIndicator
          color={liveStatus === "open" ? "var(--success)" : "var(--muted-foreground)"}
          label={liveStatus === "open" ? "Live" : liveStatus === "unsupported" ? "Live updates unsupported" : "Connecting…"}
          pulse={liveStatus === "open"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saved agents</CardTitle>
          {!agentFormOpen ? (
            <Button size="sm" variant="secondary" onClick={() => setAgentFormOpen(true)}>
              New agent
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted">
            A saved agent is a reusable name, instructions, and a capability allowlist. A run started under an agent can
            only use tools whose capability is in that list — a restriction on top of your own granted permissions, not
            a replacement for the permission check.
          </p>

          {agentFormOpen ? (
            <div className="mb-4 rounded-[var(--radius-sm)] border border-border p-3">
              <Label htmlFor="agent-name">Name</Label>
              <Input id="agent-name" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Research assistant" />
              <div className="mt-3">
                <Label htmlFor="agent-description">Description (optional)</Label>
                <Textarea id="agent-description" value={agentDescription} onChange={(e) => setAgentDescription(e.target.value)} rows={2} />
              </div>
              <div className="mt-3">
                <Label htmlFor="agent-instructions">Instructions (optional)</Label>
                <Textarea id="agent-instructions" value={agentInstructions} onChange={(e) => setAgentInstructions(e.target.value)} rows={2} />
              </div>
              <div className="mt-3">
                <Label>Allowed capabilities</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {capabilityOptions.map((cap) => {
                    const active = agentCapabilities.includes(cap);
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => toggleNewAgentCapability(cap)}
                        className={cn(
                          "vox-press rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          active ? "border-accent bg-accent-muted text-accent" : "border-border text-muted hover:text-foreground"
                        )}
                      >
                        {cap}
                      </button>
                    );
                  })}
                </div>
                {agentCapabilities.length === 0 ? (
                  <p className="mt-1 text-[11px] text-muted">No capabilities selected — this agent can only run no-tool reasoning steps.</p>
                ) : null}
              </div>
              {agentError ? <div className="mt-2"><VoxErrorPanel title="Could not save agent" message={agentError} /></div> : null}
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={createAgentDefinition} disabled={savingAgent || !agentName.trim()}>
                  {savingAgent ? "Saving…" : "Save agent"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAgentFormOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {agents.length === 0 ? (
            <p className="text-sm text-muted">No saved agents yet. Runs can still be started ad hoc below.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agents.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{a.name}</span>
                    <Badge tone={AGENT_STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Badge>
                  </div>
                  {a.description ? <p className="text-xs text-muted">{a.description}</p> : null}
                  <div className="flex flex-wrap gap-1">
                    {a.allowedCapabilities.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">no tool capabilities allowed</span>
                    ) : (
                      a.allowedCapabilities.map((cap) => (
                        <code key={cap} className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {cap}
                        </code>
                      ))
                    )}
                  </div>
                  <div className="mt-1 flex gap-3 text-[11px]">
                    {a.status !== "READY" ? (
                      <button type="button" className="text-accent hover:brightness-110" onClick={() => setAgentStatus(a.id, "READY")}>
                        Mark ready
                      </button>
                    ) : null}
                    {a.status !== "ARCHIVED" ? (
                      <button type="button" className="text-muted hover:text-foreground" onClick={() => setAgentStatus(a.id, "ARCHIVED")}>
                        Archive
                      </button>
                    ) : (
                      <button type="button" className="text-accent hover:brightness-110" onClick={() => setAgentStatus(a.id, "DRAFT")}>
                        Restore
                      </button>
                    )}
                    <button type="button" className="text-danger hover:brightness-110" onClick={() => deleteAgentDefinition(a.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
            {runnableAgents.length > 0 ? (
              <div className="mt-3">
                <Label htmlFor="agent">Run as saved agent (optional)</Label>
                <Select id="agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Ad hoc (no capability allowlist)</option>
                  {runnableAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {error ? <div className="mt-2"><VoxErrorPanel title="Run failed to start" message={error} /></div> : null}
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
            const runAgent = run.agentId ? agents.find((a) => a.id === run.agentId) : undefined;
            return (
              <Card key={run.id} className="vox-lift overflow-hidden">
                <button
                  type="button"
                  className="vox-press flex w-full items-center gap-3 px-5 py-4 text-left"
                  onClick={() => setExpanded((prev) => ({ ...prev, [run.id]: !isOpen }))}
                >
                  <VoxCore state={RUN_STATUS_CORE[run.status]} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{run.objective}</p>
                    <p className="text-xs text-muted">
                      {new Date(run.createdAt).toLocaleString()} · {run.steps.length} step
                      {run.steps.length === 1 ? "" : "s"}
                      {runAgent ? ` · ${runAgent.name}` : ""}
                    </p>
                  </div>
                  <Badge tone={RUN_STATUS_TONE[run.status]}>{run.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </button>

                {isOpen ? (
                  <CardContent>
                    {run.error ? <p className="mb-3 text-sm text-danger">{run.error}</p> : null}
                    {run.result ? <p className="mb-3 text-sm text-foreground">{run.result}</p> : null}

                    {blocked ? (
                      <div className="mb-4 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 p-3">
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
                      <p className="vox-eyebrow">Steps</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="vox-press text-xs font-medium text-accent transition-[filter] duration-200 ease-[var(--ease-luxury)] hover:brightness-110"
                          onClick={() => setDetailed((prev) => ({ ...prev, [run.id]: !isDetailed }))}
                        >
                          {isDetailed ? "Simple view" : "Detailed view"}
                        </button>
                        {run.status === "RUNNING" || run.status === "WAITING_FOR_PERMISSION" || run.status === "PLANNING" ? (
                          <button
                            type="button"
                            className="vox-press text-xs font-medium text-danger transition-[filter] duration-200 ease-[var(--ease-luxury)] hover:brightness-110"
                            onClick={() => cancelRun(run.id)}
                          >
                            Cancel run
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <ol className="flex flex-col gap-2">
                      {run.steps.map((step) => (
                        <li key={step.id} className="vox-lift rounded-[var(--radius-sm)] border border-border p-3">
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
