"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useEventStream } from "@/lib/events/useEventStream";
import { cn } from "@/lib/utils/cn";

/**
 * The workspace: VOX working, in one surface.
 *
 * Five things are shown together because separating them is what made the
 * earlier surfaces unreadable — the CHECKLIST (what VOX decided to do and how
 * far it got), the CURRENT STEP (what is happening right now), the ARTIFACTS
 * (what came back, and whether anything approved it), the REVIEWS (why a
 * candidate won or lost), and the ACTIVITY (the order it all happened in). A
 * person watching this can answer "what is it doing", "is this costing me
 * anything", "is the result any good" and "why is it stopped" without opening
 * anything else.
 *
 * UPDATES ARE EVENT-DRIVEN. It subscribes to the existing event stream and
 * refetches only when an event that could change this run arrives, rather than
 * polling on a timer. A slow heartbeat remains as a safety net for the one
 * thing the stream cannot tell it about: an external video job whose
 * CapabilityRun is closed by a later poll, not by an event.
 *
 * Everything rendered is read from real rows. There is no simulated progress:
 * a step with no recorded duration shows no duration, and a call whose
 * provider reported no cost says so rather than showing $0.00, which would
 * read as a measured "this was free".
 */

type AgentStepStatus = "PENDING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "COMPLETED" | "FAILED" | "SKIPPED";
type AgentRunStatus = "PLANNING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";
type CapabilityRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "REFUSED";
type ArtifactState = "GENERATED" | "QA_FAILED" | "APPROVED" | "ACTIVE" | "SUPERSEDED";

interface TraceStep {
  order: number;
  description: string;
  toolName: string | null;
  capability: string | null;
  requiredLevel: string;
  status: AgentStepStatus;
  error: string | null;
  durationMs: number | null;
  retryCount: number;
}

interface ProviderCall {
  id: string;
  capability: string;
  provider: string;
  model: string | null;
  status: CapabilityRunStatus;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  startedAt: string;
}

interface TraceArtifact {
  versionId: string;
  artifactId: string;
  artifactLabel: string;
  kind: string;
  version: number;
  url: string;
  mimeType: string;
  capability: string;
  provider: string;
  state: ArtifactState;
  score: number | null;
}

interface TraceReview {
  artifactId: string;
  version: number;
  status: "PASS" | "FAIL";
  score: number;
  issues: string[];
  at: string;
}

interface TraceIteration {
  artifactId: string;
  attempts: { attempt: number; of: number; status: "PASS" | "FAIL" | "RUNNING"; score: number | null }[];
  limit: number;
}

interface TraceActivity {
  id: string;
  type: string;
  at: string;
  detail: string | null;
}

export interface RunTracePayload {
  traceId: string;
  runId: string | null;
  objective: string | null;
  status: AgentRunStatus | null;
  plan: { strategy: string; degraded: boolean; notes: string[]; steps: { capability: string; reason: string; optional: boolean }[] } | null;
  steps: TraceStep[];
  awaiting: { capability: string; requiredLevel: string; toolName: string | null; description: string } | null;
  providerCalls: ProviderCall[];
  artifacts: TraceArtifact[];
  reviews: TraceReview[];
  iterations: TraceIteration[];
  activity: TraceActivity[];
  costUsd: number | null;
  unpricedCalls: number;
  live: boolean;
}

export interface ProviderStatusPayload {
  capability: string;
  providerId: string;
  displayName: string;
  configured: boolean;
  reason: string | null;
}

/** Safety net only — the event stream is the primary signal. */
const HEARTBEAT_MS = 20_000;

/** Events that could change THIS run. Anything else is ignored so an
 * unrelated memory write does not cause a refetch. */
const RELEVANT_PREFIXES = ["agent.", "capability.", "artifact.", "iteration."];

const STEP_MARK: Record<AgentStepStatus, { glyph: string; className: string; label: string }> = {
  PENDING: { glyph: "○", className: "text-muted-foreground", label: "Pending" },
  RUNNING: { glyph: "◐", className: "text-accent-blue", label: "Running" },
  WAITING_FOR_PERMISSION: { glyph: "◍", className: "text-warning", label: "Needs permission" },
  COMPLETED: { glyph: "●", className: "text-success", label: "Done" },
  FAILED: { glyph: "✕", className: "text-danger", label: "Failed" },
  SKIPPED: { glyph: "–", className: "text-muted-foreground", label: "Skipped" },
};

const RUN_STATE: Record<AgentRunStatus, { color: string; label: string; pulse: boolean }> = {
  PLANNING: { color: "var(--core-thinking)", label: "Planning", pulse: true },
  RUNNING: { color: "var(--accent-blue)", label: "Working", pulse: true },
  WAITING_FOR_PERMISSION: { color: "var(--warning)", label: "Waiting for permission", pulse: true },
  WAITING: { color: "var(--warning)", label: "Waiting", pulse: true },
  COMPLETED: { color: "var(--success)", label: "Done", pulse: false },
  FAILED: { color: "var(--danger)", label: "Failed", pulse: false },
  CANCELLED: { color: "var(--muted)", label: "Cancelled", pulse: false },
};

const ARTIFACT_STATE: Record<ArtifactState, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  GENERATED: { label: "generated", tone: "neutral" },
  QA_FAILED: { label: "failed review", tone: "danger" },
  APPROVED: { label: "approved", tone: "success" },
  ACTIVE: { label: "active", tone: "success" },
  SUPERSEDED: { label: "superseded", tone: "neutral" },
};

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Costs are shown to four decimal places because per-image prices are
 * genuinely that small; rounding to cents would render most real calls as
 * $0.00 and teach the user the number means nothing.
 */
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * Seconds are included deliberately. A run's steps happen seconds apart, so
 * HH:MM renders the entire feed as the same timestamp repeated — which tells
 * the reader nothing about order or pace.
 */
function formatClock(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Turns an event type into something a person reads without a glossary. */
const ACTIVITY_LABEL: Record<string, string> = {
  "capability.requested": "Understood the request",
  "capability.routed": "Chose an approach",
  "capability.run_started": "Started work",
  "capability.run_resumed": "Resumed after approval",
  "capability.run_cancelled": "Cancelled",
  "agent.run.started": "Execution began",
  "agent.step.completed": "Step completed",
  "agent.step.waiting_for_permission": "Paused for permission",
  "agent.run.completed": "Finished",
  "agent.run.failed": "Failed",
  "artifact.version_created": "Produced a result",
  "artifact.selected": "Selected the strongest",
  "artifact.attached": "Added to the Lab",
  "iteration.started": "Retrying",
  "iteration.completed": "Review returned",
  "iteration.failed": "Attempt failed",
};

export function RunWorkspace({
  runId,
  initial,
  providers,
  /** False renders `initial` and never fetches — used by the visual QA route,
   * which has no session and must reach nothing. */
  connected = true,
  className,
}: {
  runId: string;
  initial?: RunTracePayload;
  providers?: ProviderStatusPayload[];
  connected?: boolean;
  className?: string;
}) {
  const [trace, setTrace] = useState<RunTracePayload | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "resume" | "cancel">(null);

  const load = useCallback(async (): Promise<{ trace?: RunTracePayload; error?: string }> => {
    try {
      const response = await fetch(`/api/capabilities/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return { error: typeof body.error === "string" ? body.error : "Could not read this run." };
      }
      const body = await response.json();
      return { trace: body.trace as RunTracePayload };
    } catch {
      // A dropped read is not a failed run. Say the view is stale rather than
      // implying the work itself broke.
      return { error: "Lost contact with the server — this view may be out of date." };
    }
  }, [runId]);

  const refresh = useCallback(async () => {
    const frame = await load();
    if (frame.trace) {
      setTrace(frame.trace);
      setError(null);
    } else {
      setError(frame.error ?? "Could not read this run.");
    }
  }, [load]);

  // The primary signal: refetch when something that could change this run
  // happens, rather than on a timer.
  const onEvent = useCallback(
    (event: { type: string }) => {
      if (!RELEVANT_PREFIXES.some((prefix) => event.type.startsWith(prefix))) return;
      void refresh();
    },
    [refresh],
  );
  useEventStream({ onEvent: connected ? onEvent : undefined });

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function beat(first: boolean) {
      if (!first) {
        const frame = await load();
        if (cancelled) return;
        if (frame.trace) {
          setTrace(frame.trace);
          setError(null);
        } else {
          setError(frame.error ?? "Could not read this run.");
        }
        if (!frame.trace?.live) return;
      }
      timer = setTimeout(() => void beat(false), HEARTBEAT_MS);
    }

    // Scheduled rather than called, so nothing sets state during the effect.
    // With a server-rendered first frame there is nothing to fetch yet.
    timer = setTimeout(() => void beat(false), initial ? HEARTBEAT_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, initial, connected]);

  async function act(action: "resume" | "cancel") {
    setBusy(action);
    try {
      const response = await fetch(`/api/capabilities/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : `Could not ${action} this run.`);
        return;
      }
      if (body.trace) setTrace(body.trace as RunTracePayload);
      setError(null);
    } catch {
      setError(`Could not ${action} this run.`);
    } finally {
      setBusy(null);
    }
  }

  const current = useMemo(
    () => trace?.steps.find((s) => s.status === "RUNNING" || s.status === "WAITING_FOR_PERMISSION") ?? null,
    [trace],
  );

  if (!trace) {
    return (
      <InstrumentPanel className={cn("p-5", className)}>
        <p className="text-sm text-muted">{error ?? "Reading this run…"}</p>
      </InstrumentPanel>
    );
  }

  const state = trace.status ? RUN_STATE[trace.status] : null;
  const done = trace.steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length;
  const canCancel = trace.status ? ["PLANNING", "RUNNING", "WAITING_FOR_PERMISSION", "WAITING"].includes(trace.status) : false;

  return (
    <div className={cn("space-y-4", className)}>
      <InstrumentPanel depth="raised" live={trace.live} className="overflow-hidden">
        <PanelHeader
          eyebrow="Request"
          title={trace.objective ?? "Working"}
          description={
            trace.steps.length > 0
              ? `${done} of ${trace.steps.length} steps complete`
              : "VOX judged this needed no tools — it is answering from what it already knows."
          }
          actions={state ? <StateIndicator color={state.color} label={state.label} pulse={state.pulse} /> : null}
        />

        {error ? (
          <p className="mx-5 mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {error}
          </p>
        ) : null}

        {/* PERMISSION. Phrased as the action the user is approving, because
            "grant ACT on media.image.generate" describes the mechanism and not
            the consequence. */}
        {trace.awaiting ? (
          <div className="mx-5 mt-3 rounded-md border border-warning/40 bg-warning/10 px-3.5 py-3">
            <p className="vox-eyebrow text-warning">Needs your approval</p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{trace.awaiting.description}</p>
            <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="vox-unit">Capability</dt>
              <dd className="vox-readout text-muted">{trace.awaiting.capability}</dd>
              <dt className="vox-unit">Level</dt>
              <dd className="vox-readout text-muted">{trace.awaiting.requiredLevel}</dd>
            </dl>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
              Grant this capability in Permissions, then continue. Nothing else runs until then, and continuing
              re-checks the grant rather than assuming it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void act("resume")} disabled={busy !== null}>
                {busy === "resume" ? "Continuing…" : "Continue"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act("cancel")} disabled={busy !== null}>
                {busy === "cancel" ? "Stopping…" : "Stop here"}
              </Button>
            </div>
          </div>
        ) : null}

        {/* CHECKLIST */}
        {trace.steps.length > 0 ? (
          <>
            <Seam className="mt-4" />
            <ol className="px-5 py-3">
              {trace.steps.map((step) => {
                const mark = STEP_MARK[step.status];
                const duration = formatDuration(step.durationMs);
                return (
                  <li key={step.order} className="flex items-start gap-3 py-1.5">
                    <span className={cn("mt-0.5 w-3 shrink-0 text-center text-sm leading-5", mark.className)} aria-hidden="true">
                      {mark.glyph}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-5 text-foreground">
                        <span className="sr-only">{mark.label}: </span>
                        {step.description}
                      </p>
                      {step.error ? <p className="mt-0.5 text-[11px] leading-snug text-danger">{step.error}</p> : null}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {step.toolName ? <span className="vox-readout">{step.toolName}</span> : <span>no tool</span>}
                        {duration ? <span>· {duration}</span> : null}
                        {step.retryCount > 0 ? <span>· retried {step.retryCount}×</span> : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}

        <Seam />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {trace.providerCalls.length > 0 ? (
              <span className="vox-unit">
                {trace.providerCalls.length} provider call{trace.providerCalls.length === 1 ? "" : "s"}
              </span>
            ) : (
              // Tense matters: on a run still in flight, "was called" states a
              // conclusion the run has not reached.
              <span className="vox-unit">{trace.live ? "No provider called yet" : "No external provider was called"}</span>
            )}
            {trace.costUsd != null ? (
              <>
                <Badge tone="neutral">
                  {formatCost(trace.costUsd)}
                  {trace.unpricedCalls > 0 ? "+" : ""}
                </Badge>
                {trace.unpricedCalls > 0 ? (
                  <span className="vox-unit">
                    at least — {trace.unpricedCalls} call{trace.unpricedCalls === 1 ? "" : "s"} reported no cost
                  </span>
                ) : null}
              </>
            ) : trace.providerCalls.length > 0 ? (
              <Badge tone="neutral">{trace.live ? "cost not yet known" : "cost not reported"}</Badge>
            ) : null}
          </div>
          {canCancel && !trace.awaiting ? (
            <Button size="sm" variant="ghost" onClick={() => void act("cancel")} disabled={busy !== null}>
              {busy === "cancel" ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
        </div>
      </InstrumentPanel>

      {/* CURRENT STEP */}
      {current ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader eyebrow="Current step" title={current.description} />
          <div className="px-5 pb-4 pt-2">
            <p className="text-xs leading-relaxed text-muted">
              {current.status === "WAITING_FOR_PERMISSION"
                ? "Stopped here until the capability above is granted."
                : "Running now."}
            </p>
          </div>
        </InstrumentPanel>
      ) : null}

      {/* ARTIFACTS */}
      {trace.artifacts.length > 0 ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader
            eyebrow="Artifacts"
            title="What this produced"
            description="Every attempt is kept, including the ones nothing approved — a history showing only successes would be a history of a different run."
          />
          <Seam className="mt-4" />
          <div className="flex flex-wrap gap-3 px-5 py-4">
            {trace.artifacts.map((artifact) => {
              const chip = ARTIFACT_STATE[artifact.state];
              return (
                <figure key={artifact.versionId} className="w-32">
                  <div className="instrument-well overflow-hidden rounded-md">
                    {artifact.mimeType.startsWith("image/") ? (
                      // A plain <img>, not next/image: these are user-generated
                      // files written at runtime under /artifacts, with
                      // provider-dependent dimensions the optimizer cannot know
                      // at build time.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={artifact.url}
                        alt={`${artifact.artifactLabel}, version ${artifact.version}`}
                        loading="lazy"
                        className="h-32 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center px-2 text-center text-[11px] text-muted">
                        {artifact.mimeType}
                      </div>
                    )}
                  </div>
                  {/* Fixed three-line block. Letting the badge and score share
                      a wrapping row aligned them differently per card, because
                      "failed review" wraps where "active" does not — so a grid
                      of candidates looked ragged. */}
                  <figcaption className="mt-1.5 space-y-1">
                    <p className="vox-unit truncate">v{artifact.version} · {artifact.provider}</p>
                    <p>
                      <Badge tone={chip.tone}>{chip.label}</Badge>
                    </p>
                    <p className="vox-unit">{artifact.score != null ? `${artifact.score}/100` : " "}</p>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </InstrumentPanel>
      ) : null}

      {/* REVIEWS — the comparison behind a selection. */}
      {trace.reviews.length > 0 ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader
            eyebrow="Visual QA"
            title="How the candidates scored"
            description="Each candidate judged against the same requirements. The strongest was approved."
          />
          <Seam className="mt-4" />
          <ul className="px-5 py-3">
            {trace.reviews.map((review) => (
              <li key={`${review.artifactId}:${review.version}`} className="flex items-baseline gap-3 py-1.5">
                <span className="vox-readout w-10 shrink-0 text-xs text-muted">v{review.version}</span>
                <span
                  className={cn(
                    "vox-readout w-24 shrink-0 text-xs",
                    review.status === "PASS" ? "text-success" : "text-danger",
                  )}
                >
                  {review.status} {review.score}/100
                </span>
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
                  {review.issues.length > 0 ? review.issues.join("; ") : "No issues recorded."}
                </span>
              </li>
            ))}
          </ul>
        </InstrumentPanel>
      ) : null}

      {/* ITERATION — always "n of limit", never an open-ended loop. */}
      {trace.iterations.length > 0 ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader
            eyebrow="Quality loop"
            title="Attempts"
            description="Bounded on purpose. VOX stops at the limit rather than retrying indefinitely."
          />
          <Seam className="mt-4" />
          <div className="space-y-3 px-5 py-3">
            {trace.iterations.map((loop) => (
              <div key={loop.artifactId}>
                <ul className="space-y-1">
                  {loop.attempts.map((attempt) => (
                    <li key={attempt.attempt} className="flex items-baseline gap-3 text-xs">
                      <span className="vox-readout w-24 shrink-0 text-muted">
                        Attempt {attempt.attempt} / {loop.limit}
                      </span>
                      <span
                        className={cn(
                          attempt.status === "PASS" && "text-success",
                          attempt.status === "FAIL" && "text-danger",
                          attempt.status === "RUNNING" && "text-accent-blue",
                        )}
                      >
                        {attempt.status === "PASS" ? "✓ Passed" : attempt.status === "FAIL" ? "✗ Failed" : "Running"}
                        {attempt.score != null ? ` · ${attempt.score}/100` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </InstrumentPanel>
      ) : null}

      {/* ACTIVITY */}
      {trace.activity.length > 0 ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader eyebrow="Activity" title="In order" />
          <Seam className="mt-4" />
          <ol className="px-5 py-3">
            {trace.activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 py-0.5 text-xs">
                <span className="vox-readout shrink-0 text-muted-foreground">{formatClock(entry.at)}</span>
                <span className="text-foreground">{ACTIVITY_LABEL[entry.type] ?? entry.type}</span>
                {entry.detail ? <span className="min-w-0 truncate text-muted">{entry.detail}</span> : null}
              </li>
            ))}
          </ol>
        </InstrumentPanel>
      ) : null}

      {/* PROVIDERS — status, never a claim of connectivity. */}
      {providers && providers.length > 0 ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader
            eyebrow="Providers"
            title="What is actually available"
            description="Reported by each provider itself. A missing key is named so it can be fixed, never worked around."
          />
          <Seam className="mt-4" />
          <ul className="px-5 py-3">
            {providers.map((provider) => (
              <li key={provider.capability} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-xs">
                <span className="vox-unit w-36 shrink-0">{provider.capability}</span>
                <span className="text-foreground">{provider.displayName}</span>
                <Badge tone={provider.configured ? "success" : "warning"}>
                  {provider.configured ? "ready" : "configuration required"}
                </Badge>
                {provider.reason ? <span className="min-w-0 flex-1 text-muted">{provider.reason}</span> : null}
              </li>
            ))}
          </ul>
        </InstrumentPanel>
      ) : null}
    </div>
  );
}
