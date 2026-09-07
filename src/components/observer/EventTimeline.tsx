"use client";

import { useCallback, useEffect, useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Money, Chip, Ago, Truthless } from "@/components/observer/primitives";
import { OBSERVER_EVENT_TYPES, type TimelineEntry } from "@/lib/volara/observer-events";
import type { ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] THE FORENSIC TIMELINE.
 *
 * Filtering runs on the SERVER, through `/api/volara/events`, for two reasons:
 * a correlation-scoped question has to reach past the live window, and the
 * tenant boundary belongs in a `WHERE` clause rather than in what the client
 * chose to request.
 *
 * Nothing is synthesized. Every row is an `Event` some service really wrote.
 * When a filter matches nothing, the panel says the filter matched nothing —
 * it does not fall back to showing unrelated events so the list looks busy.
 */

const TYPE_TONE: Array<[RegExp, string]> = [
  [/^capital\.(allocated|released)/, "var(--accent)"],
  [/^capital\.(refused|rejected)/, "var(--danger)"],
  [/^capital\.requested/, "var(--warning)"],
  [/^strategy\.(killed|rejected)/, "var(--danger)"],
  [/^strategy\.activated/, "var(--accent)"],
  [/^strategy\./, "var(--accent-2)"],
  [/^agent\.(suspended|failure)/, "var(--danger)"],
  [/^agent\.state_refused/, "var(--danger)"],
  [/^volara\.escalation_refused/, "var(--danger)"],
  [/^volara\.cycle_failed/, "var(--danger)"],
  [/^volara\.(cycle|lesson)/, "var(--accent-blue)"],
  [/^policy\.(execution_refused|approval_rejected)/, "var(--danger)"],
  [/^policy\./, "var(--core-waiting)"],
  [/^economic_asset\./, "var(--success)"],
  [/^agent\.message_sent/, "var(--muted)"],
];

function toneFor(type: string): string {
  for (const [pattern, tone] of TYPE_TONE) if (pattern.test(type)) return tone;
  return "var(--accent-steel)";
}

export interface TimelineFilterState {
  agentId: string;
  strategyId: string;
  correlationId: string;
  type: string;
  consequentialOnly: boolean;
}

const EMPTY_FILTER: TimelineFilterState = {
  agentId: "",
  strategyId: "",
  correlationId: "",
  type: "",
  consequentialOnly: false,
};

export function EventTimeline({
  state,
  refreshToken,
  filter,
  onFilterChange,
  onSelectCorrelation,
}: {
  state: ObserverState;
  /** Bumped by the live stream; re-runs the query so the feed stays current. */
  refreshToken: number;
  filter: TimelineFilterState;
  onFilterChange: (next: TimelineFilterState) => void;
  onSelectCorrelation: (correlationId: string) => void;
}) {
  // Loading is DERIVED from "which request is outstanding", not set in an
  // effect. Setting it synchronously inside the effect would schedule a second
  // render pass on every filter keystroke; comparing the key the effect is
  // fetching for against the key already resolved gives the same indicator
  // with no extra state transition.
  const requestKey = `${filter.agentId}|${filter.strategyId}|${filter.correlationId}|${filter.type}|${filter.consequentialOnly}|${refreshToken}`;
  const [resolved, setResolved] = useState<{ key: string; entries: TimelineEntry[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const entries = resolved?.entries ?? null;
  const loading = resolved?.key !== requestKey && failedKey !== requestKey;
  const failed = failedKey === requestKey;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.agentId) params.set("agentId", filter.agentId);
    if (filter.strategyId) params.set("strategyId", filter.strategyId);
    if (filter.correlationId) params.set("correlationId", filter.correlationId);
    if (filter.type) params.set("type", filter.type);
    if (filter.consequentialOnly) params.set("consequentialOnly", "true");
    params.set("limit", "60");

    try {
      const response = await fetch(`/api/volara/events?${params.toString()}`);
      if (!response.ok) return { ok: false as const };
      const body = (await response.json()) as { entries: TimelineEntry[] };
      return { ok: true as const, entries: body.entries };
    } catch {
      return { ok: false as const };
    }
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    // The effect starts the request and applies the result from the callback.
    // Nothing is set synchronously here.
    load().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setResolved({ key: requestKey, entries: result.entries });
        setFailedKey(null);
      } else {
        // The previous page stays on screen rather than being replaced by an
        // empty list — a failed fetch is not evidence that nothing happened.
        setFailedKey(requestKey);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load, requestKey]);

  const filtered = Object.values(filter).some((value) => value !== "" && value !== false);

  return (
    <InstrumentPanel depth="well" sheen={false} className="overflow-hidden">
      <PanelHeader
        eyebrow="Forensic timeline"
        title="Audit trail"
        description="The real Event table, filtered on the server. Nothing here was created for display."
        actions={
          filtered ? (
            <button
              type="button"
              onClick={() => onFilterChange(EMPTY_FILTER)}
              className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground"
            >
              Clear filters
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2 px-5 pt-3">
        <select
          aria-label="Filter by agent"
          value={filter.agentId}
          onChange={(e) => onFilterChange({ ...filter, agentId: e.target.value })}
          className="min-h-9 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 text-xs text-foreground sm:min-h-0"
        >
          <option value="">All agents</option>
          {state.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by strategy"
          value={filter.strategyId}
          onChange={(e) => onFilterChange({ ...filter, strategyId: e.target.value })}
          className="min-h-9 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 text-xs text-foreground sm:min-h-0"
        >
          <option value="">All strategies</option>
          {state.strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by event type"
          value={filter.type}
          onChange={(e) => onFilterChange({ ...filter, type: e.target.value })}
          className="min-h-9 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 text-xs text-foreground sm:min-h-0"
        >
          <option value="">All event types</option>
          {OBSERVER_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <input
          aria-label="Filter by correlation ID"
          value={filter.correlationId}
          onChange={(e) => onFilterChange({ ...filter, correlationId: e.target.value })}
          placeholder="Correlation ID"
          className="min-h-9 w-44 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-solid)] px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground sm:min-h-0"
        />

        <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs text-muted sm:min-h-0">
          <input
            type="checkbox"
            checked={filter.consequentialOnly}
            onChange={(e) => onFilterChange({ ...filter, consequentialOnly: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          Consequential only
        </label>
      </div>

      <Seam className="mt-3" />

      <div className="max-h-[26rem] overflow-y-auto px-3 py-3">
        {failed ? (
          <p className="mb-2 px-2 text-[11px] text-[var(--warning)]">
            The last refresh failed. Showing the previous result rather than an empty list.
          </p>
        ) : null}

        {loading && entries === null ? (
          <p className="vox-unit px-2 py-6 text-center text-muted-foreground">LOADING</p>
        ) : entries && entries.length > 0 ? (
          <ol className="flex flex-col gap-0.5">
            {entries.map((entry) => {
              const tone = toneFor(entry.type);
              return (
                <li
                  key={entry.id}
                  className="group flex items-start gap-2.5 rounded-[var(--radius-xs)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: tone }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px]" style={{ color: tone }}>
                        {entry.type}
                      </span>
                      {entry.consequential ? <Chip tone="var(--accent)">Consequential</Chip> : null}
                      {entry.amountCents !== null ? (
                        <span className="text-[11px] text-muted">
                          <Money cents={entry.amountCents} />
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
                      {entry.subjectType ? (
                        <span>
                          {entry.subjectType}
                          {entry.subjectId ? ` · ${entry.subjectId.slice(0, 8)}` : ""}
                        </span>
                      ) : null}
                      {entry.correlationId ? (
                        <button
                          type="button"
                          onClick={() => onSelectCorrelation(entry.correlationId!)}
                          className="font-mono underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
                        >
                          trace {entry.correlationId.slice(0, 8)}
                        </button>
                      ) : null}
                    </p>
                  </div>
                  <Ago at={entry.at} className="shrink-0 text-[10px] text-muted-foreground" />
                </li>
              );
            })}
          </ol>
        ) : (
          <Truthless
            label={filtered ? "NO EVENTS MATCH THIS FILTER" : "NO RECORDED EVENTS"}
            detail={
              filtered
                ? "The filter is applied at the database. Nothing matching it exists in this account's audit trail."
                : "The audit trail is empty for this account. It fills as the runtime does real work."
            }
          />
        )}
      </div>
    </InstrumentPanel>
  );
}

export { EMPTY_FILTER };
