"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea, Label } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { SupervisorPanel, type SupervisorRunItem } from "@/components/objectives/SupervisorPanel";
import { useEventStream } from "@/lib/events/useEventStream";
import type { LiveEvent } from "@/lib/events/bus";

interface ObjectiveItem {
  id: string;
  title: string;
  description: string | null;
  strategy: string | null;
  assumptions: string[];
  targetValue: number | null;
  targetUnit: string | null;
  currentValue: number | null;
  targetDate: string | null;
  status: string;
  createdAt: string;
}

interface OpportunityItem {
  id: string;
  objectiveId: string;
  title: string;
  description: string | null;
  estimatedValue: number | null;
  effort: string | null;
  confidence: string;
  risk: string | null;
  nextAction: string | null;
  status: string;
  /** Omitted (not fabricated as 0) until the next full page load recomputes it server-side. */
  score?: number;
  scoreBreakdown?: {
    value: number;
    valueIsAssumedDefault: boolean;
    effort: string | null;
    effortWeight: number;
    confidenceWeight: number;
    riskPenalty: number;
    capitalDivisor: number;
    operatingDivisor: number;
    marginMultiplier: number;
    speedMultiplier: number;
  };
  category: string | null;
  estimatedStartupCost: number | null;
  estimatedTimeToRevenueDays: number | null;
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  ACHIEVED: "success",
  ABANDONED: "neutral",
  IDEA: "neutral",
  DISCOVERED: "neutral",
  RESEARCHING: "accent",
  EVALUATING: "warning",
  WATCHLIST: "neutral",
  APPROVED: "accent",
  PLANNING: "accent",
  EXECUTING: "accent",
  VALIDATING: "warning",
  FAILED: "danger",
  COMPLETED: "success",
  REJECTED: "danger",
};

export function ObjectivesClient({
  objectives: initialObjectives,
  opportunities: initialOpportunities,
  supervisorRuns: initialSupervisorRuns,
}: {
  objectives: ObjectiveItem[];
  opportunities: OpportunityItem[];
  supervisorRuns: SupervisorRunItem[];
}) {
  const [objectives, setObjectives] = useState(initialObjectives);
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [supervisorRuns, setSupervisorRuns] = useState(initialSupervisorRuns);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refreshSupervisorRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/supervisor/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setSupervisorRuns((prev) => (prev.some((r) => r.id === id) ? prev.map((r) => (r.id === id ? data.run : r)) : [data.run, ...prev]));
  }, []);

  const handleLiveEvent = useCallback(
    (event: LiveEvent) => {
      if (event.subjectType === "SupervisorRun" && event.subjectId) void refreshSupervisorRun(event.subjectId);
    },
    [refreshSupervisorRun]
  );
  const { status: liveStatus } = useEventStream({ onEvent: handleLiveEvent });
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", strategy: "", targetValue: "", targetUnit: "" });

  async function createObjective() {
    if (!draft.title.trim()) return;
    setCreating(true);
    const res = await fetch("/api/objectives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description || undefined,
        strategy: draft.strategy || undefined,
        targetValue: draft.targetValue ? Number(draft.targetValue) : undefined,
        targetUnit: draft.targetUnit || undefined,
      }),
    });
    setCreating(false);
    if (res.ok) {
      const data = await res.json();
      setObjectives((prev) => [
        {
          id: data.objective.id,
          title: data.objective.title,
          description: data.objective.description,
          strategy: data.objective.strategy,
          assumptions: data.objective.assumptions ?? [],
          targetValue: data.objective.targetValue,
          targetUnit: data.objective.targetUnit,
          currentValue: data.objective.currentValue,
          targetDate: data.objective.targetDate,
          status: data.objective.status,
          createdAt: data.objective.createdAt,
        },
        ...prev,
      ]);
      setDraft({ title: "", description: "", strategy: "", targetValue: "", targetUnit: "" });
      setShowCreate(false);
    }
  }

  async function updateObjectiveStatus(id: string, status: string) {
    setObjectives((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await fetch(`/api/objectives/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function updateProgress(id: string, currentValue: string) {
    const value = currentValue === "" ? null : Number(currentValue);
    setObjectives((prev) => prev.map((o) => (o.id === id ? { ...o, currentValue: value } : o)));
    await fetch(`/api/objectives/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: value }),
    });
  }

  async function deleteObjective(id: string) {
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    setOpportunities((prev) => prev.filter((o) => o.objectiveId !== id));
    await fetch(`/api/objectives/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-end gap-2">
        <StateIndicator
          color={liveStatus === "open" ? "var(--success)" : "var(--muted-foreground)"}
          label={liveStatus === "open" ? "Live" : liveStatus === "unsupported" ? "Live updates unsupported" : "Connecting…"}
          pulse={liveStatus === "open"}
        />
        <Button size="sm" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "New Objective"}
        </Button>
      </div>

      {showCreate ? (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>New objective</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <Label>Title</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Generate $25,000 as quickly and realistically possible"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>Strategy notes (optional)</Label>
              <Textarea
                rows={3}
                value={draft.strategy}
                onChange={(e) => setDraft((d) => ({ ...d, strategy: e.target.value }))}
                placeholder="How you and VOX plan to approach this — left blank until there's a real plan."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target value (optional)</Label>
                <Input
                  type="number"
                  value={draft.targetValue}
                  onChange={(e) => setDraft((d) => ({ ...d, targetValue: e.target.value }))}
                  placeholder="25000"
                />
              </div>
              <div>
                <Label>Unit</Label>
                <Input
                  value={draft.targetUnit}
                  onChange={(e) => setDraft((d) => ({ ...d, targetUnit: e.target.value }))}
                  placeholder="USD"
                />
              </div>
            </div>
            <div>
              <Button disabled={creating || !draft.title.trim()} onClick={createObjective}>
                Create Objective
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        {objectives.length === 0 ? (
          <EmptyState
            title="No objectives yet"
            description="Create one to give VOX something real to help you pursue. VOX won't invent progress on it."
          />
        ) : (
          objectives.map((o) => {
            const objOpportunities = opportunities.filter((op) => op.objectiveId === o.id);
            const progress =
              o.targetValue && o.targetValue > 0 && o.currentValue != null
                ? Math.min(1, Math.max(0, o.currentValue / o.targetValue))
                : null;
            return (
              <Card key={o.id} className="vox-lift">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{o.title}</h3>
                        <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{o.status.toLowerCase()}</Badge>
                      </div>
                      {o.description ? <p className="mt-1 text-sm text-muted">{o.description}</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}>
                        {expandedId === o.id ? "Close" : "Open"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteObjective(o.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  {o.targetValue != null ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span>
                          {o.currentValue ?? 0} / {o.targetValue} {o.targetUnit ?? ""}
                        </span>
                        {progress != null ? <span>{Math.round(progress * 100)}%</span> : <span>not started</span>}
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                          style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {expandedId === o.id ? (
                    <ObjectiveDetail
                      objective={o}
                      opportunities={objOpportunities}
                      supervisorRuns={supervisorRuns.filter((s) => s.objectiveId === o.id)}
                      onUpdateStatus={(status) => updateObjectiveStatus(o.id, status)}
                      onUpdateProgress={(value) => updateProgress(o.id, value)}
                      onOpportunitiesChange={setOpportunities}
                      onSupervisorRunsChange={setSupervisorRuns}
                      onValidated={(newObjective) => {
                        setObjectives((prev) => [newObjective, ...prev]);
                        setExpandedId(newObjective.id);
                      }}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function ObjectiveDetail({
  objective,
  opportunities,
  supervisorRuns,
  onUpdateStatus,
  onUpdateProgress,
  onOpportunitiesChange,
  onSupervisorRunsChange,
  onValidated,
}: {
  objective: ObjectiveItem;
  opportunities: OpportunityItem[];
  supervisorRuns: SupervisorRunItem[];
  onUpdateStatus: (status: string) => void;
  onUpdateProgress: (value: string) => void;
  onOpportunitiesChange: (updater: (prev: OpportunityItem[]) => OpportunityItem[]) => void;
  onSupervisorRunsChange: (updater: (prev: SupervisorRunItem[]) => SupervisorRunItem[]) => void;
  onValidated: (objective: ObjectiveItem) => void;
}) {
  const [showAddOpportunity, setShowAddOpportunity] = useState(false);
  const [creating, setCreating] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [whyId, setWhyId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: "",
    estimatedValue: "",
    effort: "",
    confidence: "LOW",
    risk: "",
    nextAction: "",
    category: "",
    estimatedStartupCost: "",
    estimatedTimeToRevenueDays: "",
  });

  async function validateOpportunity(op: OpportunityItem) {
    setValidatingId(op.id);
    try {
      const res = await fetch(`/api/opportunities/${op.id}/validate`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onOpportunitiesChange((prev) => prev.map((o) => (o.id === op.id ? { ...o, status: data.opportunity.status } : o)));
        onValidated({
          id: data.objective.id,
          title: data.objective.title,
          description: data.objective.description,
          strategy: data.objective.strategy,
          assumptions: data.objective.assumptions ?? [],
          targetValue: data.objective.targetValue,
          targetUnit: data.objective.targetUnit,
          currentValue: data.objective.currentValue,
          targetDate: data.objective.targetDate,
          status: data.objective.status,
          createdAt: data.objective.createdAt,
        });
      }
    } finally {
      setValidatingId(null);
    }
  }

  async function addOpportunity() {
    if (!draft.title.trim()) return;
    setCreating(true);
    const res = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectiveId: objective.id,
        title: draft.title,
        estimatedValue: draft.estimatedValue ? Number(draft.estimatedValue) : undefined,
        effort: draft.effort || undefined,
        confidence: draft.confidence,
        risk: draft.risk || undefined,
        nextAction: draft.nextAction || undefined,
        category: draft.category || undefined,
        estimatedStartupCost: draft.estimatedStartupCost ? Number(draft.estimatedStartupCost) : undefined,
        estimatedTimeToRevenueDays: draft.estimatedTimeToRevenueDays ? Number(draft.estimatedTimeToRevenueDays) : undefined,
      }),
    });
    setCreating(false);
    if (res.ok) {
      const data = await res.json();
      onOpportunitiesChange((prev) => [
        {
          id: data.opportunity.id,
          objectiveId: data.opportunity.objectiveId,
          title: data.opportunity.title,
          description: data.opportunity.description,
          estimatedValue: data.opportunity.estimatedValue,
          effort: data.opportunity.effort,
          confidence: data.opportunity.confidence,
          risk: data.opportunity.risk,
          nextAction: data.opportunity.nextAction,
          status: data.opportunity.status,
          category: data.opportunity.category,
          estimatedStartupCost: data.opportunity.estimatedStartupCost,
          estimatedTimeToRevenueDays: data.opportunity.estimatedTimeToRevenueDays,
        },
        ...prev,
      ]);
      setDraft({
        title: "",
        estimatedValue: "",
        effort: "",
        confidence: "LOW",
        risk: "",
        nextAction: "",
        category: "",
        estimatedStartupCost: "",
        estimatedTimeToRevenueDays: "",
      });
      setShowAddOpportunity(false);
    }
  }

  async function updateOpportunityStatus(id: string, status: string) {
    onOpportunitiesChange((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function deleteOpportunity(id: string) {
    onOpportunitiesChange((prev) => prev.filter((o) => o.id !== id));
    await fetch(`/api/opportunities/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      {objective.strategy ? (
        <div className="mb-3">
          <p className="vox-eyebrow">Strategy</p>
          <p className="mt-1 text-sm text-foreground">{objective.strategy}</p>
        </div>
      ) : null}

      {objective.assumptions.length > 0 ? (
        <div className="mb-3">
          <p className="vox-eyebrow">Assumptions</p>
          <ul className="mt-1 list-inside list-disc text-sm text-foreground">
            {objective.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Status</Label>
          <Select value={objective.status} onChange={(e) => onUpdateStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="ACHIEVED">Achieved</option>
            <option value="ABANDONED">Abandoned</option>
          </Select>
        </div>
        {objective.targetValue != null ? (
          <div>
            <Label>Current progress ({objective.targetUnit ?? "value"})</Label>
            <Input
              type="number"
              defaultValue={objective.currentValue ?? ""}
              onBlur={(e) => onUpdateProgress(e.target.value)}
              placeholder="Only what you tell VOX — nothing inferred"
            />
          </div>
        ) : null}
      </div>

      <SupervisorPanel objectiveId={objective.id} runs={supervisorRuns} onRunsChange={onSupervisorRunsChange} />

      <div className="mt-4 flex items-center justify-between">
        <p className="vox-eyebrow">Opportunities</p>
        <Button size="sm" variant="ghost" onClick={() => setShowAddOpportunity((s) => !s)}>
          {showAddOpportunity ? "Cancel" : "Add opportunity"}
        </Button>
      </div>

      {showAddOpportunity ? (
        <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border p-3">
          <Input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Opportunity title"
          />
          <Textarea
            rows={2}
            value={draft.nextAction}
            onChange={(e) => setDraft((d) => ({ ...d, nextAction: e.target.value }))}
            placeholder="The single concrete next action, if you know it"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              type="number"
              value={draft.estimatedValue}
              onChange={(e) => setDraft((d) => ({ ...d, estimatedValue: e.target.value }))}
              placeholder="Est. value"
            />
            <Select value={draft.effort} onChange={(e) => setDraft((d) => ({ ...d, effort: e.target.value }))}>
              <option value="">Effort</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </Select>
            <Select value={draft.confidence} onChange={(e) => setDraft((d) => ({ ...d, confidence: e.target.value }))}>
              <option value="LOW">Confidence: Low</option>
              <option value="MEDIUM">Confidence: Medium</option>
              <option value="HIGH">Confidence: High</option>
              <option value="CONFIRMED">Confidence: Confirmed</option>
            </Select>
            <Select value={draft.risk} onChange={(e) => setDraft((d) => ({ ...d, risk: e.target.value }))}>
              <option value="">Risk</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              placeholder="Category (e.g. lead-generation)"
            />
            <Input
              type="number"
              value={draft.estimatedStartupCost}
              onChange={(e) => setDraft((d) => ({ ...d, estimatedStartupCost: e.target.value }))}
              placeholder="Startup cost ($)"
            />
            <Input
              type="number"
              value={draft.estimatedTimeToRevenueDays}
              onChange={(e) => setDraft((d) => ({ ...d, estimatedTimeToRevenueDays: e.target.value }))}
              placeholder="Days to revenue"
            />
          </div>
          <div>
            <Button size="sm" disabled={creating || !draft.title.trim()} onClick={addOpportunity}>
              Add
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted">
            No opportunities evaluated yet. VOX won&apos;t suggest fake &quot;hustle ideas&quot; here — add one once
            there&apos;s a real option worth weighing.
          </p>
        ) : (
          [...opportunities].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)).map((op) => (
            <div key={op.id} className="vox-lift instrument instrument-sheen rounded-[var(--radius-sm)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{op.title}</p>
                  {op.category ? <p className="mt-0.5 text-xs text-muted-foreground">{op.category}</p> : null}
                  {op.nextAction ? <p className="mt-0.5 text-xs text-muted">Next: {op.nextAction}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Select
                    value={op.status}
                    onChange={(e) => updateOpportunityStatus(op.id, e.target.value)}
                    className="!w-auto py-1 text-xs"
                  >
                    <option value="IDEA">Idea</option>
                    <option value="DISCOVERED">Discovered</option>
                    <option value="RESEARCHING">Researching</option>
                    <option value="EVALUATING">Evaluating</option>
                    <option value="WATCHLIST">Watchlist</option>
                    <option value="APPROVED">Approved</option>
                    <option value="PLANNING">Planning</option>
                    <option value="EXECUTING">Executing</option>
                    <option value="VALIDATING">Validating</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="FAILED">Failed</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="REJECTED">Rejected</option>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => deleteOpportunity(op.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {op.score != null ? (
                  <button
                    type="button"
                    className="vox-press"
                    onClick={() => setWhyId(whyId === op.id ? null : op.id)}
                    title="Why this score?"
                  >
                    <Badge tone="accent">score {op.score.toFixed(2)} · why?</Badge>
                  </button>
                ) : null}
                {op.estimatedValue != null ? <Badge>{op.estimatedValue} est. value</Badge> : null}
                {op.estimatedStartupCost != null ? <Badge>${op.estimatedStartupCost} startup</Badge> : null}
                {op.estimatedTimeToRevenueDays != null ? <Badge>{op.estimatedTimeToRevenueDays}d to revenue</Badge> : null}
                {op.effort ? <Badge>{op.effort.toLowerCase()} effort</Badge> : null}
                <Badge tone={op.confidence === "CONFIRMED" || op.confidence === "HIGH" ? "accent" : "neutral"}>
                  {op.confidence.toLowerCase()} confidence
                </Badge>
                {op.risk ? (
                  <Badge tone={op.risk === "HIGH" ? "danger" : op.risk === "MEDIUM" ? "warning" : "neutral"}>
                    {op.risk.toLowerCase()} risk
                  </Badge>
                ) : null}
              </div>
              {whyId === op.id && op.scoreBreakdown ? (
                <div className="mt-2 rounded-[var(--radius-sm)] border border-border bg-surface-hover p-2 text-xs text-muted">
                  <p className="mb-1 vox-eyebrow">Why this score</p>
                  <ul className="flex flex-col gap-0.5">
                    <li>Value: {op.scoreBreakdown.value}{op.scoreBreakdown.valueIsAssumedDefault ? " (assumed — not entered)" : ""}</li>
                    <li>Effort weight: /{op.scoreBreakdown.effortWeight} ({op.scoreBreakdown.effort ?? "assumed medium"})</li>
                    <li>Confidence weight: ×{op.scoreBreakdown.confidenceWeight}</li>
                    <li>Risk penalty: −{Math.round(op.scoreBreakdown.riskPenalty * 100)}%</li>
                    <li>Startup capital drag: ÷{op.scoreBreakdown.capitalDivisor.toFixed(2)}</li>
                    <li>Operating cost drag: ÷{op.scoreBreakdown.operatingDivisor.toFixed(2)}</li>
                    <li>Margin: ×{op.scoreBreakdown.marginMultiplier.toFixed(2)}</li>
                    <li>Speed to revenue: ×{op.scoreBreakdown.speedMultiplier.toFixed(2)}</li>
                    <li>Complexity/competition/human-involvement penalties applied where set; scalability bonus where set.</li>
                  </ul>
                </div>
              ) : null}
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => validateOpportunity(op)} disabled={validatingId === op.id}>
                  {validatingId === op.id ? "Creating objective…" : "Validate this opportunity"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
