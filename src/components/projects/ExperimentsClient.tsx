"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ResultItem {
  id: string;
  outcome: string;
  confidence: string;
}
interface ExperimentItem {
  id: string;
  hypothesis: string;
  status: string;
  results: ResultItem[];
}

export function ExperimentsClient({ initialExperiments }: { initialExperiments: ExperimentItem[] }) {
  const [experiments, setExperiments] = useState(initialExperiments);
  const [hypothesis, setHypothesis] = useState("");
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, string>>({});

  async function createExperiment() {
    if (!hypothesis.trim()) return;
    const res = await fetch("/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hypothesis }),
    });
    if (res.ok) {
      const data = await res.json();
      setExperiments((prev) => [{ ...data.experiment, results: [] }, ...prev]);
      setHypothesis("");
    }
  }

  async function addResult(experimentId: string) {
    const outcome = outcomeDrafts[experimentId]?.trim();
    if (!outcome) return;
    const res = await fetch(`/api/experiments/${experimentId}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    if (res.ok) {
      const data = await res.json();
      setExperiments((prev) =>
        prev.map((e) => (e.id === experimentId ? { ...e, results: [...e.results, data.result] } : e))
      );
      setOutcomeDrafts((prev) => ({ ...prev, [experimentId]: "" }));
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New experiment</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="What are you testing?" />
          <Button size="sm" onClick={createExperiment} disabled={!hypothesis.trim()}>
            Start experiment
          </Button>
        </CardContent>
      </Card>

      {experiments.length === 0 ? (
        <EmptyState title="No experiments yet" description="Turn an idea into a testable hypothesis to track what you learn." />
      ) : (
        <ul className="flex flex-col gap-3">
          {experiments.map((e) => (
            <li key={e.id}>
              <Card className="vox-lift">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{e.hypothesis}</p>
                    <Badge>{e.status.toLowerCase()}</Badge>
                  </div>
                  {e.results.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {e.results.map((r) => (
                        <li key={r.id} className="flex items-center justify-between text-sm">
                          <span className="text-muted">{r.outcome}</span>
                          <ConfidenceBadge confidence={r.confidence} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={outcomeDrafts[e.id] ?? ""}
                      onChange={(ev) => setOutcomeDrafts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                      placeholder="Record an outcome / learning..."
                    />
                    <Button size="sm" variant="secondary" onClick={() => addResult(e.id)}>
                      Log result
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
