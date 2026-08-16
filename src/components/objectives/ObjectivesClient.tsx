"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea, Label } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

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
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  ACHIEVED: "success",
  ABANDONED: "neutral",
  IDEA: "neutral",
  EVALUATING: "warning",
  COMPLETED: "success",
  REJECTED: "danger",
};

export function ObjectivesClient({
  objectives: initialObjectives,
  opportunities: initialOpportunities,
}: {
  objectives: ObjectiveItem[];
  opportunities: OpportunityItem[];
}) {
  const [objectives, setObjectives] = useState(initialObjectives);
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      <div className="flex justify-end">
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
                      onUpdateStatus={(status) => updateObjectiveStatus(o.id, status)}
                      onUpdateProgress={(value) => updateProgress(o.id, value)}
                      onOpportunitiesChange={setOpportunities}
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
  onUpdateStatus,
  onUpdateProgress,
  onOpportunitiesChange,
}: {
  objective: ObjectiveItem;
  opportunities: OpportunityItem[];
  onUpdateStatus: (status: string) => void;
  onUpdateProgress: (value: string) => void;
  onOpportunitiesChange: (updater: (prev: OpportunityItem[]) => OpportunityItem[]) => void;
}) {
  const [showAddOpportunity, setShowAddOpportunity] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    estimatedValue: "",
    effort: "",
    confidence: "LOW",
    risk: "",
    nextAction: "",
  });

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
        },
        ...prev,
      ]);
      setDraft({ title: "", estimatedValue: "", effort: "", confidence: "LOW", risk: "", nextAction: "" });
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
          opportunities.map((op) => (
            <div key={op.id} className="vox-lift glass-panel rounded-[var(--radius-sm)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{op.title}</p>
                  {op.nextAction ? <p className="mt-0.5 text-xs text-muted">Next: {op.nextAction}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Select
                    value={op.status}
                    onChange={(e) => updateOpportunityStatus(op.id, e.target.value)}
                    className="!w-auto py-1 text-xs"
                  >
                    <option value="IDEA">Idea</option>
                    <option value="EVALUATING">Evaluating</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="REJECTED">Rejected</option>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => deleteOpportunity(op.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {op.estimatedValue != null ? <Badge>{op.estimatedValue} est. value</Badge> : null}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
