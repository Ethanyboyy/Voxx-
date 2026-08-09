"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface DimensionProfile {
  dimension: string;
  observationCount: number;
  confidence: string;
  estimate: string | null;
  trend: string;
  evidence: string[];
  hasData: boolean;
}

interface PatternItem {
  id: string;
  type: string;
  description: string;
  confidence: string;
  status: string;
  occurrenceCount: number;
  lastDetectedAt: string;
}

interface HypothesisItem {
  id: string;
  statement: string;
  status: string;
  confidence: string;
}

export function CognitionClient({
  profile,
  patterns: initialPatterns,
  hypotheses,
}: {
  profile: DimensionProfile[];
  patterns: PatternItem[];
  hypotheses: HypothesisItem[];
}) {
  const [patterns, setPatterns] = useState(initialPatterns);
  const [detecting, setDetecting] = useState(false);

  async function handleDetect() {
    setDetecting(true);
    const res = await fetch("/api/patterns/detect", { method: "POST" });
    setDetecting(false);
    if (res.ok) {
      const listRes = await fetch("/api/patterns");
      const data = await listRes.json();
      setPatterns(data.patterns);
    }
  }

  async function handleDismiss(id: string) {
    setPatterns((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/patterns/${id}/dismiss`, { method: "POST" });
  }

  const dataDimensions = profile.filter((d) => d.hasData);
  const emptyDimensions = profile.filter((d) => !d.hasData);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile dimensions</CardTitle>
        </CardHeader>
        <CardContent>
          {dataDimensions.length === 0 ? (
            <EmptyState
              title="No observations recorded yet"
              description="Every dimension below starts with an explicit 'no data yet' state — VOX never fabricates a baseline."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {dataDimensions.map((d) => (
                <div key={d.dimension} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{d.dimension.toLowerCase().replace(/_/g, " ")}</span>
                    <ConfidenceBadge confidence={d.confidence} />
                  </div>
                  {d.estimate ? <p className="mt-1 text-sm text-muted">{d.estimate}</p> : null}
                  <p className="mt-1 text-xs text-muted">
                    {d.observationCount} observation{d.observationCount === 1 ? "" : "s"} · trend: {d.trend}
                  </p>
                </div>
              ))}
            </div>
          )}
          {emptyDimensions.length > 0 ? (
            <p className="mt-4 text-xs text-muted">
              No data yet for: {emptyDimensions.map((d) => d.dimension.toLowerCase().replace(/_/g, " ")).join(", ")}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurring patterns</CardTitle>
          <Button size="sm" variant="secondary" onClick={handleDetect} disabled={detecting}>
            {detecting ? "Scanning..." : "Scan for patterns"}
          </Button>
        </CardHeader>
        <CardContent>
          {patterns.length === 0 ? (
            <EmptyState title="No patterns detected" description="Run a scan once you have some projects, decisions, and ideas to look across." />
          ) : (
            <ul className="flex flex-col gap-2">
              {patterns.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="warning">{p.type.toLowerCase().replace(/_/g, " ")}</Badge>
                    <ConfidenceBadge confidence={p.confidence} />
                  </div>
                  <p className="mt-2 text-sm text-foreground">{p.description}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span>Seen {p.occurrenceCount}×</span>
                    <Button size="sm" variant="ghost" onClick={() => handleDismiss(p.id)}>
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hypotheses</CardTitle>
        </CardHeader>
        <CardContent>
          {hypotheses.length === 0 ? (
            <EmptyState title="No open hypotheses" />
          ) : (
            <ul className="flex flex-col gap-2">
              {hypotheses.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">{h.statement}</span>
                  <div className="flex items-center gap-2">
                    <Badge>{h.status.toLowerCase()}</Badge>
                    <ConfidenceBadge confidence={h.confidence} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
