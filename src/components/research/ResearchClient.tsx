"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Card, CardContent } from "@/components/ui/Card";
import { ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ResearchItem {
  id: string;
  query: string;
  provider: string;
  title: string | null;
  sourceUrl: string | null;
  summary: string | null;
  relevance: number | null;
  confidence: string;
  retrievedAt: string;
}

export function ResearchClient({ initialItems }: { initialItems: ResearchItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Research request failed." }));
      setError(body.error ?? "Research request failed.");
      return;
    }
    const data = await res.json();
    setItems((prev) => [...data.items, ...prev]);
    setQuery("");
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardContent className="flex gap-2 pt-5">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What do you want VOX to research?" />
          <Button onClick={handleRun} disabled={busy || !query.trim()}>
            {busy ? "Running..." : "Run research"}
          </Button>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {items.length === 0 ? (
        <EmptyState title="No research run yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted">query: {item.query}</p>
                    </div>
                    <ConfidenceBadge confidence={item.confidence} />
                  </div>
                  {item.summary ? <p className="mt-2 text-sm text-muted">{item.summary}</p> : null}
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                    <span>provider: {item.provider}</span>
                    <span>retrieved {new Date(item.retrievedAt).toLocaleString()}</span>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-accent">
                        source
                      </a>
                    ) : null}
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
