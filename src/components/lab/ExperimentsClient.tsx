"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, ConfidenceTag } from "@/components/lab/primitives";

interface ExperimentListItem {
  id: string;
  code: string;
  title: string;
  hypothesis: string;
  status: string;
  confidence: string;
  suitCodename: string | null;
  resultCount: number;
  updatedAt: string;
}

const STATUS_ORDER = ["PLANNED", "RUNNING", "COMPLETED", "FAILED", "ABANDONED"] as const;
const STATUS_FILTERS = ["all", ...STATUS_ORDER] as const;

export function ExperimentsClient({
  initialExperiments,
  suits,
  projects,
}: {
  initialExperiments: ExperimentListItem[];
  suits: { id: string; codename: string }[];
  projects: { id: string; name: string }[];
}) {
  const [experiments, setExperiments] = useState(initialExperiments);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const groups: { status: string; items: ExperimentListItem[] }[] =
    filter === "all"
      ? STATUS_ORDER.map((status) => ({ status, items: experiments.filter((e) => e.status === status) })).filter(
          (g) => g.items.length > 0
        )
      : [{ status: filter, items: experiments.filter((e) => e.status === filter) }];

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="lab-mono inline-flex flex-wrap rounded-full border border-border bg-surface p-0.5 text-[11px]">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 font-semibold uppercase tracking-wider transition-colors ${
                filter === f
                  ? "bg-accent-muted text-accent shadow-[0_0_10px_-4px_var(--accent)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={filter === f}
            >
              {f === "all" ? "All" : f.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Experiment"}
        </Button>
      </div>

      {showForm ? (
        <NewExperimentForm
          suits={suits}
          projects={projects}
          onCreated={(exp) => {
            setExperiments((prev) => [
              {
                id: exp.id,
                code: exp.code,
                title: exp.title,
                hypothesis: exp.hypothesis,
                status: exp.status,
                confidence: exp.confidence,
                suitCodename: suits.find((s) => s.id === exp.suitId)?.codename ?? null,
                resultCount: 0,
                updatedAt: exp.updatedAt,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/experiments/${exp.id}`);
          }}
        />
      ) : null}

      {total === 0 ? (
        <EmptyState
          title="No experiments yet"
          description="Create an experiment with a hypothesis and objective to start iterating."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.status}>
              {filter === "all" ? (
                <div className="mb-2 flex items-center gap-2">
                  <LabStatusBadge status={g.status} />
                  <span className="text-xs text-muted-foreground">
                    {g.items.length} experiment{g.items.length === 1 ? "" : "s"}
                  </span>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((e) => (
                  <Link key={e.id} href={`/lab/experiments/${e.id}`}>
                    <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="lab-mono text-[10px] text-muted-foreground">{e.code}</p>
                          <p className="font-semibold text-foreground">{e.title}</p>
                        </div>
                        <LabStatusBadge status={e.status} />
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted">{e.hypothesis}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <ConfidenceTag confidence={e.confidence} />
                        <span className="text-[11px] text-muted-foreground">
                          {e.suitCodename ? e.suitCodename : "No suit"} · {e.resultCount} result
                          {e.resultCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </HolographicPanel>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface VariableRow {
  name: string;
  value: string;
  unit: string;
}

function NewExperimentForm({
  suits,
  projects,
  onCreated,
}: {
  suits: { id: string; codename: string }[];
  projects: { id: string; name: string }[];
  onCreated: (exp: {
    id: string;
    code: string;
    title: string;
    hypothesis: string;
    status: string;
    confidence: string;
    suitId: string | null;
    updatedAt: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [objective, setObjective] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [suitId, setSuitId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [variables, setVariables] = useState<VariableRow[]>([{ name: "", value: "", unit: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateVariable(index: number, field: keyof VariableRow, value: string) {
    setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  }

  function addVariable() {
    setVariables((prev) => [...prev, { name: "", value: "", unit: "" }]);
  }

  function removeVariable(index: number) {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!hypothesis.trim()) {
      setError("Hypothesis is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const cleanVariables = variables.filter((v) => v.name.trim() && v.value.trim());
    const res = await fetch("/api/lab/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        hypothesis,
        objective: objective || undefined,
        expectedOutcome: expectedOutcome || undefined,
        suitId: suitId || undefined,
        projectId: projectId || undefined,
        variables:
          cleanVariables.length > 0
            ? cleanVariables.map((v) => ({ name: v.name, value: v.value, unit: v.unit || undefined }))
            : undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.experiment);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create experiment.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <LabSectionLabel>New Experiment</LabSectionLabel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wall-crawling grip vs. surface angle" />
        </div>
        <div className="sm:col-span-2">
          <Label>Hypothesis</Label>
          <Textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} placeholder="What do you expect, and why?" />
        </div>
        <div className="sm:col-span-2">
          <Label>Objective (optional)</Label>
          <Textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="What outcome would confirm or deny the hypothesis?" />
        </div>
        <div className="sm:col-span-2">
          <Label>Expected outcome (optional)</Label>
          <Textarea value={expectedOutcome} onChange={(e) => setExpectedOutcome(e.target.value)} rows={2} />
        </div>
        <div>
          <Label>Suit (optional)</Label>
          <Select value={suitId} onChange={(e) => setSuitId(e.target.value)}>
            <option value="">No suit</option>
            {suits.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codename}
              </option>
            ))}
          </Select>
        </div>
        {projects.length > 0 ? (
          <div>
            <Label>Project (optional)</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Variables</p>
      <div className="flex flex-col gap-2">
        {variables.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_80px_auto] gap-2">
            <Input value={v.name} onChange={(e) => updateVariable(i, "name", e.target.value)} placeholder="Name" />
            <Input value={v.value} onChange={(e) => updateVariable(i, "value", e.target.value)} placeholder="Value" />
            <Input value={v.unit} onChange={(e) => updateVariable(i, "unit", e.target.value)} placeholder="Unit" />
            <Button size="sm" variant="secondary" onClick={() => removeVariable(i)} disabled={variables.length === 1}>
              Remove
            </Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" className="self-start" onClick={addVariable}>
          + Add variable
        </Button>
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating…" : "Create Experiment"}
      </Button>
    </HolographicPanel>
  );
}
