"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea, Select } from "@/components/ui/Field";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, ConfidenceTag } from "@/components/lab/primitives";

interface VariableRow {
  name: string;
  value: string;
  unit?: string;
}

interface ExperimentResult {
  id: string;
  outcome: string;
  learnings: string | null;
  confidence: string;
  createdAt: string;
}

interface ExperimentDetail {
  id: string;
  code: string;
  title: string;
  hypothesis: string;
  objective: string | null;
  variables: string | null;
  equipmentNotes: string | null;
  environmentNotes: string | null;
  expectedOutcome: string | null;
  status: string;
  confidence: string;
  nextIteration: string | null;
  suit: { id: string; codename: string; stats: { mobility: number; durability: number } | null } | null;
  simulationRun: { id: string; simulationId: string; summary: string | null } | null;
  results: ExperimentResult[];
}

const CONFIDENCE_OPTIONS = ["VERIFIED", "ESTIMATED", "HYPOTHETICAL", "UNKNOWN"] as const;

function parseVariables(raw: string | null): VariableRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ExperimentDetailClient({ experiment }: { experiment: ExperimentDetail }) {
  const router = useRouter();
  const [status, setStatusState] = useState(experiment.status);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [nextIteration, setNextIteration] = useState(experiment.nextIteration ?? "");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const [results, setResults] = useState(experiment.results);
  const [outcome, setOutcome] = useState("");
  const [learnings, setLearnings] = useState("");
  const [resultConfidence, setResultConfidence] = useState<(typeof CONFIDENCE_OPTIONS)[number]>("ESTIMATED");
  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);

  const variables = parseVariables(experiment.variables);

  async function updateStatus(next: string) {
    setStatusBusy(true);
    setStatusError(null);
    const res = await fetch(`/api/lab/experiments/${experiment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setStatusBusy(false);
    if (res.ok) {
      const data = await res.json();
      setStatusState(data.experiment.status);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setStatusError(data.error ?? "Failed to update status.");
    }
  }

  async function saveNextIteration() {
    setNoteBusy(true);
    setNoteSaved(false);
    const res = await fetch(`/api/lab/experiments/${experiment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextIteration }),
    });
    setNoteBusy(false);
    if (res.ok) {
      setNoteSaved(true);
      router.refresh();
    }
  }

  async function addResult() {
    if (!outcome.trim()) {
      setResultError("Outcome is required.");
      return;
    }
    setResultBusy(true);
    setResultError(null);
    const res = await fetch(`/api/lab/experiments/${experiment.id}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, learnings: learnings || undefined, confidence: resultConfidence }),
    });
    setResultBusy(false);
    if (res.ok) {
      const data = await res.json();
      setResults((prev) => [
        { id: data.result.id, outcome: data.result.outcome, learnings: data.result.learnings, confidence: data.result.confidence, createdAt: data.result.createdAt },
        ...prev,
      ]);
      setOutcome("");
      setLearnings("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setResultError(data.error ?? "Failed to add result.");
    }
  }

  async function askAi() {
    setAiBusy(true);
    setAiReply(null);
    const res = await fetch("/api/lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Analyze experiment ${experiment.code}` }),
    });
    const data = await res.json();
    setAiReply(data.reply ?? "No response.");
    setAiBusy(false);
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="lab-mono text-xs text-muted-foreground">{experiment.code}</p>
            <LabStatusBadge status={status} />
          </div>
          <h1 className="vox-headline mt-1 text-2xl">{experiment.title}</h1>
          {experiment.suit ? (
            <p className="mt-1 text-sm text-muted">
              Linked suit:{" "}
              <Link href={`/lab/suits/${experiment.suit.id}`} className="text-accent hover:underline">
                {experiment.suit.codename}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={askAi} disabled={aiBusy}>
            {aiBusy ? "Analyzing…" : "Ask AI Engineer"}
          </Button>
        </div>
      </div>

      {aiReply ? (
        <HolographicPanel className="p-4 text-sm text-foreground">
          <LabSectionLabel>AI Lab Engineer</LabSectionLabel>
          <p className="mt-2 whitespace-pre-wrap">{aiReply}</p>
        </HolographicPanel>
      ) : null}

      <HolographicPanel className="p-4">
        <LabSectionLabel>Status</LabSectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "PLANNED" ? (
            <>
              <Button size="sm" onClick={() => updateStatus("RUNNING")} disabled={statusBusy}>
                Start Running
              </Button>
              <Button size="sm" variant="secondary" onClick={() => updateStatus("ABANDONED")} disabled={statusBusy}>
                Abandon
              </Button>
            </>
          ) : null}
          {status === "RUNNING" ? (
            <>
              <Button size="sm" onClick={() => updateStatus("COMPLETED")} disabled={statusBusy}>
                Mark Completed
              </Button>
              <Button size="sm" variant="danger" onClick={() => updateStatus("FAILED")} disabled={statusBusy}>
                Mark Failed
              </Button>
              <Button size="sm" variant="secondary" onClick={() => updateStatus("ABANDONED")} disabled={statusBusy}>
                Abandon
              </Button>
            </>
          ) : null}
          {status === "COMPLETED" || status === "FAILED" || status === "ABANDONED" ? (
            <p className="text-sm text-muted">This experiment has reached a terminal state.</p>
          ) : null}
        </div>
        {statusError ? <p className="mt-2 text-sm text-danger">{statusError}</p> : null}
      </HolographicPanel>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <HolographicPanel className="p-4">
            <LabSectionLabel>Hypothesis</LabSectionLabel>
            <p className="mt-2 text-sm text-foreground">{experiment.hypothesis}</p>
            {experiment.objective ? (
              <>
                <LabSectionLabel className="mt-4">Objective</LabSectionLabel>
                <p className="mt-2 text-sm text-muted">{experiment.objective}</p>
              </>
            ) : null}
            {experiment.expectedOutcome ? (
              <>
                <LabSectionLabel className="mt-4">Expected Outcome</LabSectionLabel>
                <p className="mt-2 text-sm text-muted">{experiment.expectedOutcome}</p>
              </>
            ) : null}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Confidence</span>
              <ConfidenceTag confidence={experiment.confidence} />
            </div>
          </HolographicPanel>

          {variables.length > 0 ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Variables</LabSectionLabel>
              <div className="mt-3 space-y-1.5">
                {variables.map((v, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{v.name}</span>
                    <span className="lab-mono text-foreground">
                      {v.value}
                      {v.unit ? <span className="ml-1 text-muted-foreground">{v.unit}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </HolographicPanel>
          ) : null}

          {experiment.simulationRun ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Linked Simulation Run</LabSectionLabel>
              <p className="mt-2 text-sm text-muted">{experiment.simulationRun.summary ?? "No summary."}</p>
              <Link
                href={`/lab/simulation/${experiment.simulationRun.simulationId}`}
                className="mt-2 inline-block text-sm text-accent hover:underline"
              >
                View simulation →
              </Link>
            </HolographicPanel>
          ) : null}

          <HolographicPanel className="p-4">
            <LabSectionLabel>Results</LabSectionLabel>
            <div className="mt-3 flex flex-col gap-2">
              <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} placeholder="Outcome observed…" />
              <Textarea value={learnings} onChange={(e) => setLearnings(e.target.value)} rows={2} placeholder="Learnings (optional)…" />
              <div className="flex items-center gap-2">
                <Select
                  value={resultConfidence}
                  onChange={(e) => setResultConfidence(e.target.value as (typeof CONFIDENCE_OPTIONS)[number])}
                  className="max-w-[160px]"
                >
                  {CONFIDENCE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Button size="sm" onClick={addResult} disabled={resultBusy}>
                  {resultBusy ? "Saving…" : "Add Result"}
                </Button>
              </div>
              {resultError ? <p className="text-sm text-danger">{resultError}</p> : null}
            </div>

            <div className="mt-4 space-y-3 border-t border-border pt-3">
              {results.length === 0 ? (
                <p className="text-sm text-muted">No results recorded yet.</p>
              ) : (
                results.map((r) => (
                  <div key={r.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground">{r.outcome}</span>
                      <ConfidenceTag confidence={r.confidence} />
                    </div>
                    {r.learnings ? <p className="mt-1 text-xs text-muted">{r.learnings}</p> : null}
                    <p className="lab-mono mt-1 text-[10px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </HolographicPanel>
        </div>

        <div className="flex flex-col gap-4">
          {experiment.equipmentNotes || experiment.environmentNotes ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Notes</LabSectionLabel>
              {experiment.equipmentNotes ? (
                <p className="mt-2 text-xs text-muted">
                  <span className="text-muted-foreground">Equipment: </span>
                  {experiment.equipmentNotes}
                </p>
              ) : null}
              {experiment.environmentNotes ? (
                <p className="mt-2 text-xs text-muted">
                  <span className="text-muted-foreground">Environment: </span>
                  {experiment.environmentNotes}
                </p>
              ) : null}
            </HolographicPanel>
          ) : null}

          <HolographicPanel className="p-4">
            <LabSectionLabel>Next Iteration</LabSectionLabel>
            <Textarea
              value={nextIteration}
              onChange={(e) => {
                setNextIteration(e.target.value);
                setNoteSaved(false);
              }}
              rows={4}
              className="mt-2"
              placeholder="What would you try next?"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={saveNextIteration} disabled={noteBusy}>
                {noteBusy ? "Saving…" : "Save"}
              </Button>
              {noteSaved ? <span className="text-xs text-success">Saved.</span> : null}
            </div>
          </HolographicPanel>
        </div>
      </div>
    </div>
  );
}
