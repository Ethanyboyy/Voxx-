"use client";

import { useCallback, useEffect, useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Chip, Truthless } from "@/components/observer/primitives";
import type { CycleTrace } from "@/lib/volara/observer";
import { cn } from "@/lib/utils/cn";

/**
 * [P4-G] FORENSIC RECONSTRUCTION. Not a storytelling engine.
 *
 * The chain is rendered as a fixed sequence of stages, and each stage is either
 * PRESENT with its real rows or explicitly NOT YET OCCURRED. That distinction
 * is the whole design: a stage rendered as an empty box reads as "nothing
 * interesting", while one rendered as NOT YET OCCURRED reads as "this has not
 * happened", and only the second is honest about a cycle that stopped early.
 *
 * Nothing is inferred between stages. If a capital request exists but no
 * approval does, the approval stage says so — it does not narrate a reason.
 */

interface Stage {
  key: string;
  label: string;
  tone: string;
  count: number;
  detail: React.ReactNode;
}

export function CorrelationTrace({
  correlationId,
  onCorrelationIdChange,
}: {
  correlationId: string;
  onCorrelationIdChange: (next: string) => void;
}) {
  // Like the timeline: the outstanding request's key is compared against the
  // resolved one, so "loading" and "failed" are derived rather than set inside
  // an effect. `trace` is only ever written from a resolved fetch.
  const [resolved, setResolved] = useState<{ id: string; trace: CycleTrace | null; error: string | null } | null>(null);

  const trace = resolved?.id === correlationId ? resolved.trace : null;
  const error = resolved?.id === correlationId ? resolved.error : null;
  const loading = Boolean(correlationId) && resolved?.id !== correlationId;

  // Syncing the draft input to a changed prop, adjusted during render with a
  // previous-value guard rather than in an effect — the pattern React
  // documents for exactly this, and it avoids the extra commit an effect costs.
  const [draft, setDraft] = useState(correlationId);
  const [lastPropId, setLastPropId] = useState(correlationId);
  if (lastPropId !== correlationId) {
    setLastPropId(correlationId);
    setDraft(correlationId);
  }

  const load = useCallback(async (id: string): Promise<{ trace: CycleTrace | null; error: string | null }> => {
    try {
      const response = await fetch(`/api/volara/trace/${encodeURIComponent(id)}`);
      if (!response.ok) return { trace: null, error: "That trace could not be read." };
      return { trace: (await response.json()) as CycleTrace, error: null };
    } catch {
      return { trace: null, error: "That trace could not be read." };
    }
  }, []);

  useEffect(() => {
    if (!correlationId) return;
    let cancelled = false;
    load(correlationId).then((result) => {
      if (cancelled) return;
      setResolved({ id: correlationId, trace: result.trace, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [correlationId, load]);

  const stages: Stage[] = trace
    ? [
        {
          key: "opportunity",
          label: "Opportunity",
          tone: "var(--accent-blue)",
          count: trace.opportunities.length,
          detail: trace.opportunities.map((o) => o.title).join(" · "),
        },
        {
          key: "message",
          label: "Challenge / message",
          tone: "var(--muted)",
          count: trace.messages.length,
          detail: `${trace.messages.length} recorded — information only, authorizes nothing`,
        },
        {
          key: "strategy",
          label: "Strategy",
          tone: "var(--accent-2)",
          count: trace.strategies.length,
          detail: trace.strategies.map((s) => `${s.name} (${s.status})`).join(" · "),
        },
        {
          key: "run",
          label: "Agent run",
          tone: "var(--core-executing)",
          count: trace.runs.length,
          detail: trace.runs.map((r) => `${r.status} · ${r.steps.length} step(s)`).join(" · "),
        },
        {
          key: "allocation",
          label: "Capital request",
          tone: "var(--warning)",
          count: trace.allocations.length,
          detail: trace.allocations
            .map((a) => `${a.status} · ${(a.requestedCents / 100).toFixed(2)} USD`)
            .join(" · "),
        },
        {
          key: "approval",
          label: "Human authorization",
          tone: "var(--accent)",
          count: trace.allocations.filter((a) => a.approvalGrantId !== null).length,
          detail: trace.allocations
            .filter((a) => a.approvalGrantId !== null)
            .map((a) => `grant ${a.approvalGrantId!.slice(0, 8)} · reserved ${(a.approvedCents / 100).toFixed(2)} USD`)
            .join(" · "),
        },
        {
          key: "transition",
          label: "Lifecycle transitions",
          tone: "var(--core-thinking)",
          count: trace.transitions.length,
          detail: trace.transitions
            .slice(0, 4)
            .map((t) => `${t.fromState}→${t.toState}${t.refused ? " (refused)" : ""}`)
            .join(" · "),
        },
        {
          key: "event",
          label: "Recorded events",
          tone: "var(--success)",
          count: trace.events.length,
          detail: `${trace.events.filter((e) => e.consequential).length} consequential`,
        },
      ]
    : [];

  return (
    <InstrumentPanel className="overflow-hidden">
      <PanelHeader
        eyebrow="Correlation trace"
        title="Forensic reconstruction"
        description="One cycle, reassembled from the rows that carry its id. Stages that did not happen say so."
      />

      <form
        className="flex flex-wrap gap-2 px-5 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          onCorrelationIdChange(draft.trim());
        }}
      >
        <input
          aria-label="Correlation ID"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a correlation ID, or select one from the timeline"
          className="min-w-0 flex-1 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-solid)] px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-[var(--accent)] hover:text-foreground"
        >
          Trace
        </button>
      </form>

      <Seam className="mt-3" />

      <div className="p-4">
        {!correlationId ? (
          <Truthless
            label="NO TRACE SELECTED"
            detail="Choose a correlation ID from the timeline, or paste one above, to reconstruct everything that cycle produced."
          />
        ) : loading ? (
          <p className="vox-unit py-6 text-center text-muted-foreground">READING TRACE</p>
        ) : error ? (
          <Truthless label="TRACE UNAVAILABLE" detail={error} />
        ) : trace && stages.some((stage) => stage.count > 0) ? (
          <ol className="flex flex-col gap-1.5">
            {stages.map((stage) => {
              const occurred = stage.count > 0;
              return (
                <li
                  key={stage.key}
                  className={cn(
                    "flex items-start gap-3 rounded-[var(--radius-xs)] border px-3 py-2.5",
                    occurred ? "border-[var(--instrument-border-lit)]" : "border-dashed border-border"
                  )}
                  style={occurred ? { background: `color-mix(in srgb, ${stage.tone} 6%, transparent)` } : undefined}
                >
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: occurred ? stage.tone : "var(--border-strong)" }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{stage.label}</span>
                      {occurred ? (
                        <Chip tone={stage.tone}>{stage.count}</Chip>
                      ) : (
                        <span className="vox-unit text-muted-foreground">NOT YET OCCURRED</span>
                      )}
                    </p>
                    {occurred && stage.detail ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{stage.detail}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <Truthless
            label="NO ACTIVITY FOR THIS CORRELATION ID"
            detail="Nothing in this account carries that id. It may belong to another account, in which case it is not visible here."
          />
        )}
      </div>
    </InstrumentPanel>
  );
}
