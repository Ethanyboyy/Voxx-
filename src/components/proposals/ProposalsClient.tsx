"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ProposalItem {
  id: string;
  observation: string;
  connection: string | null;
  implication: string | null;
  suggestedAction: string;
  actionType: string;
  capability: string;
  requiredLevel: string;
  confidence: string;
  status: string;
  result: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function ProposalsClient({ initialProposals }: { initialProposals: ProposalItem[] }) {
  const [proposals, setProposals] = useState(initialProposals);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function approve(id: string) {
    setBusyId(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    const res = await fetch(`/api/proposals/${id}/approve`, { method: "POST" });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setErrors((prev) => ({
        ...prev,
        [id]: res.status === 403 ? `Permission required: grant "${data.capability}" at ${data.requiredLevel} in Settings.` : data.error ?? "Approval failed.",
      }));
      return;
    }
    setProposals((prev) => prev.map((p) => (p.id === id ? data.proposal : p)));
  }

  async function deny(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/proposals/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setBusyId(null);
    if (res.ok) setProposals((prev) => prev.map((p) => (p.id === id ? data.proposal : p)));
  }

  const pending = proposals.filter((p) => p.status === "PROPOSED");
  const resolved = proposals.filter((p) => p.status !== "PROPOSED");

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            description="Proposals show up here when VOX detects something worth a look — e.g. a memory contradiction, or a pattern in your projects. Try Memory → Check for conflicts, or Cognition → Scan for patterns."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="accent">{p.actionType}</Badge>
                      <ConfidenceBadge confidence={p.confidence} />
                    </div>
                    <p className="text-sm text-foreground">
                      <span className="font-medium">Observed:</span> {p.observation}
                    </p>
                    {p.connection ? <p className="text-sm text-muted">{p.connection}</p> : null}
                    {p.implication ? <p className="text-sm text-muted">{p.implication}</p> : null}
                    <p className="text-sm font-medium text-accent">Suggested: {p.suggestedAction}</p>
                    <p className="text-xs text-muted">
                      Requires <span className="font-mono">{p.capability}</span> at {p.requiredLevel}
                    </p>
                    {errors[p.id] ? (
                      <p className="text-xs text-danger">
                        {errors[p.id]} <Link href="/settings" className="underline">Go to Settings</Link>
                      </p>
                    ) : null}
                    <div className="mt-1 flex gap-2">
                      <Button size="sm" onClick={() => approve(p.id)} disabled={busyId === p.id}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deny(p.id)} disabled={busyId === p.id}>
                        Deny
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">History</h2>
          <ul className="flex flex-col gap-2">
            {resolved.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground">{p.suggestedAction}</span>
                  <Badge
                    tone={p.status === "EXECUTED" ? "success" : p.status === "DENIED" ? "neutral" : "danger"}
                  >
                    {p.status.toLowerCase()}
                  </Badge>
                </div>
                {p.result ? <p className="mt-1 text-xs text-muted">{p.result}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
