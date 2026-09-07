"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RoomHeader, Atmosphere } from "@/components/ui/Instrument";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { useEventStream } from "@/lib/events/useEventStream";
import { isObserverEvent } from "@/lib/volara/observer-events";
import { GlobalState } from "@/components/observer/GlobalState";
import { AgentSociety } from "@/components/observer/AgentSociety";
import { ApprovalCenter } from "@/components/observer/ApprovalCenter";
import { InteractionGraph } from "@/components/observer/InteractionGraph";
import { EventTimeline, EMPTY_FILTER, type TimelineFilterState } from "@/components/observer/EventTimeline";
import { CorrelationTrace } from "@/components/observer/CorrelationTrace";
import { AgentDetail, StrategyDetail, StrategyList } from "@/components/observer/DetailPanels";
import { SystemHealth } from "@/components/observer/SystemHealth";
import type { ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] THE OBSERVER, ASSEMBLED.
 *
 * THE LIVE-UPDATE RULE, and it is the important part of this file:
 *
 *   A live event NEVER patches local state. It only triggers a re-read of the
 *   authoritative server projection.
 *
 * The alternative — applying an event's payload to a client-side copy — would
 * make the browser a second place where runtime economics are computed, and
 * the two would drift the first time an event was missed, arrived twice, or
 * arrived out of order. Since the server projection is derived from rows on
 * every read, re-reading is both simpler and the only version that is correct
 * after a dropped connection. That also makes reconnect rehydration free:
 * `EventSource` reconnects on its own, the next event refetches, and there is
 * no stale local model to reconcile because there was never a local model.
 *
 * Refetches are COALESCED. A cycle emits a burst of events in a few hundred
 * milliseconds, and one refetch per event would be a self-inflicted load test.
 * A trailing debounce collapses the burst into a single read.
 *
 * The filter is narrowed rather than the data: only event types the Observer
 * actually renders trigger a read (`isObserverEvent`), so a busy chat session
 * or a memory write does not refetch a screen none of it changes.
 */

const REFETCH_DEBOUNCE_MS = 400;

export function ObserverClient({ initialState }: { initialState: ObserverState }) {
  const [state, setState] = useState<ObserverState>(initialState);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [staleSince, setStaleSince] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState("");
  const [filter, setFilter] = useState<TimelineFilterState>(EMPTY_FILTER);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  /** Re-reads the authoritative projection. The only way state ever changes. */
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch("/api/volara/state");
      if (!response.ok) {
        // A failed read leaves the last good snapshot on screen and says it is
        // stale. Blanking the screen would imply the runtime went quiet, which
        // is a different and untrue thing.
        setStaleSince((current) => current ?? new Date().toISOString());
        return;
      }
      setState((await response.json()) as ObserverState);
      setStaleSince(null);
      setRefreshToken((token) => token + 1);
    } catch {
      setStaleSince((current) => current ?? new Date().toISOString());
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), REFETCH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const { status } = useEventStream({
    onEvent: (event) => {
      if (isObserverEvent(event.type)) scheduleRefresh();
    },
  });

  // A reconnect is a gap in which events were missed, so the projection is
  // re-read once the stream comes back rather than trusting what is on screen.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current !== "open" && status === "open") scheduleRefresh();
    previousStatus.current = status;
  }, [status, scheduleRefresh]);

  const selectedStrategy = selectedStrategyId
    ? (state.strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null)
    : null;

  const streamLabel =
    status === "open" ? "LIVE" : status === "connecting" ? "RECONNECTING" : "STREAM UNAVAILABLE";
  const streamColor =
    status === "open" ? "var(--success)" : status === "connecting" ? "var(--warning)" : "var(--muted)";

  return (
    <div className="relative">
      <Atmosphere />

      <div className="relative mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
        <RoomHeader
          system="VOX"
          title="Global Observer"
          description={
            <>
              The truthful projection of the Volara runtime. Every figure is derived from real rows at read time — if
              the runtime does not know something, this screen says so rather than filling the gap.
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <StateIndicator
                color={streamColor}
                label={streamLabel}
                detail={refreshing ? "reading" : null}
                pulse={status === "open"}
              />
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
              >
                Refresh
              </button>
            </div>
          }
        />

        {staleSince ? (
          <p className="mt-4 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3.5 py-2.5 text-xs text-[var(--warning)]">
            The last read of the authoritative state failed. What is shown below is the previous snapshot and may be out
            of date — it is not a report that the runtime went quiet.
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-4">
          <GlobalState state={state} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <AgentSociety
              state={state}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(agentId) => {
                setSelectedAgentId(agentId);
                if (agentId) setSelectedStrategyId(null);
              }}
            />
            <div className="flex flex-col gap-4">
              <SystemHealth state={state} />
              <StrategyList
                state={state}
                selectedId={selectedStrategyId}
                onSelect={(strategyId) => {
                  setSelectedStrategyId(strategyId);
                  if (strategyId) setSelectedAgentId(null);
                }}
              />
            </div>
          </div>

          {selectedAgentId ? (
            <AgentDetail state={state} agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
          ) : null}
          {selectedStrategy ? (
            <StrategyDetail state={state} strategy={selectedStrategy} onClose={() => setSelectedStrategyId(null)} />
          ) : null}

          <ApprovalCenter state={state} onChanged={() => void refresh()} />

          <InteractionGraph state={state} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <EventTimeline
              state={state}
              refreshToken={refreshToken}
              filter={filter}
              onFilterChange={setFilter}
              onSelectCorrelation={setCorrelationId}
            />
            <CorrelationTrace correlationId={correlationId} onCorrelationIdChange={setCorrelationId} />
          </div>
        </div>
      </div>
    </div>
  );
}
