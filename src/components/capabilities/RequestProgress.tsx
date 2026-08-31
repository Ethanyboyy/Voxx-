"use client";

import { useCallback, useEffect, useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";

/**
 * What VOX is doing, while it does it.
 *
 * Three things are shown together because separating them is what made the
 * previous surfaces confusing: the CHECKLIST (what VOX decided to do and how
 * far it has got), the PROVIDER CALLS (who was actually asked, on which model,
 * at what cost) and the ARTIFACTS (what came back). A user watching this can
 * answer "what is it doing", "is this costing me anything" and "is the result
 * any good" without opening anything else.
 *
 * Everything here is read from real rows. There is no simulated progress: a
 * step with no recorded duration shows no duration, and a call whose provider
 * reported no cost says so rather than showing $0.00, which would read as a
 * measured "this was free".
 */

type AgentStepStatus = "PENDING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "COMPLETED" | "FAILED" | "SKIPPED";
type AgentRunStatus = "PLANNING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";
type CapabilityRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "REFUSED";

interface ProgressStep {
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

interface ProgressArtifact {
  versionId: string;
  artifactId: string;
  version: number;
  url: string;
  mimeType: string;
  capability: string;
  provider: string;
}

export interface RequestProgressPayload {
  traceId: string;
  runId: string | null;
  objective: string | null;
  status: AgentRunStatus | null;
  steps: ProgressStep[];
  awaiting: { capability: string; requiredLevel: string; toolName: string | null } | null;
  providerCalls: ProviderCall[];
  artifacts: ProgressArtifact[];
  costUsd: number | null;
  unpricedCalls: number;
  live: boolean;
}

const POLL_MS = 2000;

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

export function RequestProgress({
  traceId,
  runId,
  initial,
  poll = true,
  className,
}: {
  traceId: string;
  runId?: string | null;
  /** Server-rendered first frame, so the panel never opens empty. */
  initial?: RequestProgressPayload;
  /**
   * Set false to render `initial` and never fetch. Used by the visual QA
   * route, which has no session and must reach nothing — and by any caller
   * showing a frame it already has.
   */
  poll?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = useState<RequestProgressPayload | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  /** Fetches one frame. Returns it rather than setting state, so the caller
   * owns the decision to apply it — which is what makes unmount safe. */
  const load = useCallback(async (): Promise<{ progress?: RequestProgressPayload; error?: string }> => {
    const params = new URLSearchParams({ traceId });
    if (runId) params.set("runId", runId);
    try {
      const response = await fetch(`/api/capabilities/progress?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return { error: typeof body.error === "string" ? body.error : "Could not read progress." };
      }
      const body = await response.json();
      return { progress: body.progress as RequestProgressPayload };
    } catch {
      // A dropped poll is not a failed run. Say the view is stale rather than
      // implying the work itself broke.
      return { error: "Lost contact with the server — this view may be out of date." };
    }
  }, [traceId, runId]);

  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      const frame = await load();
      if (cancelled) return;
      if (frame.progress) {
        setProgress(frame.progress);
        setError(null);
      } else {
        setError(frame.error ?? "Could not read progress.");
      }
      // Polling STOPS once nothing can change, rather than running forever
      // against a finished run. A transport error keeps it going, since the
      // run itself may well still be progressing.
      if (frame.progress ? frame.progress.live : true) {
        timer = setTimeout(() => void tick(), POLL_MS);
      }
    }

    // Scheduled rather than called: a first frame supplied by the server needs
    // no immediate refetch, and nothing sets state during the effect itself.
    timer = setTimeout(() => void tick(), initial ? POLL_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, initial, poll]);

  if (!progress) {
    return (
      <InstrumentPanel className={cn("p-5", className)}>
        <p className="text-sm text-muted">Reading progress…</p>
      </InstrumentPanel>
    );
  }

  const state = progress.status ? RUN_STATE[progress.status] : null;
  const done = progress.steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length;
  // The eyebrow names WHAT this panel is, not what state it is in. State is
  // already carried by the indicator on the right, and duplicating it there
  // produced a header reading "Done … Done".
  const eyebrow = "Request";

  return (
    <InstrumentPanel depth="raised" live={progress.live} className={cn("overflow-hidden", className)}>
      <PanelHeader
        eyebrow={eyebrow}
        title={progress.objective ?? "Answering directly"}
        description={
          progress.steps.length > 0
            ? `${done} of ${progress.steps.length} steps complete`
            : "VOX judged this needed no tools — it is answering from what it already knows."
        }
        actions={
          state ? <StateIndicator color={state.color} label={state.label} pulse={state.pulse} /> : null
        }
      />

      {error ? (
        <p className="mx-5 mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {error}
        </p>
      ) : null}

      {progress.awaiting ? (
        <div className="mx-5 mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
          <p className="text-xs font-medium text-warning">
            Paused: this needs {progress.awaiting.requiredLevel} on {progress.awaiting.capability}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Nothing further runs until you grant it in Permissions. VOX will pick up from this step.
          </p>
        </div>
      ) : null}

      {progress.steps.length > 0 ? (
        <>
          <Seam className="mt-4" />
          <ol className="px-5 py-3">
            {progress.steps.map((step) => {
              const mark = STEP_MARK[step.status];
              const duration = formatDuration(step.durationMs);
              return (
                <li key={step.order} className="flex items-start gap-3 py-1.5">
                  <span
                    className={cn("mt-0.5 w-3 shrink-0 text-center text-sm leading-5", mark.className)}
                    aria-hidden="true"
                  >
                    {mark.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Wraps rather than truncating: at mobile width a step
                        description is the primary content, and "Apply the
                        chosen lens profile to the Suit Bay …" hides the part
                        that says what was actually done. */}
                    <p className="text-sm leading-5 text-foreground">
                      <span className="sr-only">{mark.label}: </span>
                      {step.description}
                    </p>
                    {step.error ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-danger">{step.error}</p>
                    ) : null}
                    {expanded ? (
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {step.toolName ? <span className="vox-readout">{step.toolName}</span> : <span>no tool</span>}
                        {duration ? <span>· {duration}</span> : null}
                        {step.retryCount > 0 ? <span>· retried {step.retryCount}×</span> : null}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {progress.artifacts.length > 0 ? (
        <>
          <Seam />
          <div className="px-5 py-4">
            <p className="vox-eyebrow">Produced</p>
            <div className="mt-2.5 flex flex-wrap gap-3">
              {progress.artifacts.map((artifact) => (
                <figure key={artifact.versionId} className="w-28">
                  <div className="instrument-well overflow-hidden rounded-md">
                    {artifact.mimeType.startsWith("image/") ? (
                      // A plain <img>, not next/image: these are user-generated
                      // files written at runtime under /artifacts, with
                      // provider-dependent dimensions the optimizer cannot know
                      // at build time.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={artifact.url}
                        alt={`${artifact.capability} result, version ${artifact.version}`}
                        className="h-28 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-28 items-center justify-center text-[11px] text-muted">
                        {artifact.mimeType}
                      </div>
                    )}
                  </div>
                  <figcaption className="vox-unit mt-1.5 truncate">v{artifact.version} · {artifact.provider}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <Seam />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {progress.providerCalls.length > 0 ? (
            <span className="vox-unit">
              {progress.providerCalls.length} provider call{progress.providerCalls.length === 1 ? "" : "s"}
            </span>
          ) : (
            // Tense matters: on a run still in flight, "was called" states a
            // conclusion the run has not reached. A paused run may well call a
            // provider the moment its permission is granted.
            <span className="vox-unit">
              {progress.live ? "No provider called yet" : "No external provider was called"}
            </span>
          )}
          {progress.costUsd != null ? (
            <>
              {/* The trailing "+" is load-bearing: some calls reported no cost,
                  so this total is a floor rather than the full bill. It is
                  spelled out beside the badge as well — a bare "+" is a symbol
                  only the person who wrote it understands. */}
              <Badge tone="neutral">
                {formatCost(progress.costUsd)}
                {progress.unpricedCalls > 0 ? "+" : ""}
              </Badge>
              {progress.unpricedCalls > 0 ? (
                <span className="vox-unit">
                  at least — {progress.unpricedCalls} call{progress.unpricedCalls === 1 ? "" : "s"} reported no cost
                </span>
              ) : null}
            </>
          ) : progress.providerCalls.length > 0 ? (
            // Same tense problem as the line above: a call still in flight has
            // not declined to report a cost, it simply has not finished.
            <Badge tone="neutral">{progress.live ? "cost not yet known" : "cost not reported"}</Badge>
          ) : null}
        </div>
        {progress.providerCalls.length > 0 || progress.steps.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? "Hide detail" : "Show detail"}
          </button>
        ) : null}
      </div>

      {expanded && progress.providerCalls.length > 0 ? (
        <div className="instrument-well mx-5 mb-5 overflow-x-auto rounded-md">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Capability</th>
                <th scope="col" className="px-3 py-2 font-medium">Provider / model</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Duration</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {progress.providerCalls.map((call) => (
                <tr key={call.id} className="border-t border-border/60">
                  <td className="px-3 py-2 text-foreground">{call.capability}</td>
                  <td className="px-3 py-2 text-muted">
                    {call.provider}
                    {call.model ? <span className="vox-readout"> · {call.model}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        call.status === "SUCCEEDED" && "text-success",
                        call.status === "FAILED" && "text-danger",
                        call.status === "REFUSED" && "text-warning",
                        call.status === "RUNNING" && "text-accent-blue",
                      )}
                    >
                      {call.status.toLowerCase()}
                    </span>
                    {call.error ? <span className="block text-[11px] text-muted">{call.error}</span> : null}
                  </td>
                  <td className="vox-readout px-3 py-2 text-right text-muted">
                    {formatDuration(call.durationMs) ?? "—"}
                  </td>
                  <td className="vox-readout px-3 py-2 text-right text-muted">
                    {/* An unfinished call gets the same em dash as its
                        duration. "not reported" is a statement about a call
                        that finished and declined to price itself. */}
                    {call.costUsd != null
                      ? formatCost(call.costUsd)
                      : call.status === "RUNNING"
                        ? "—"
                        : "not reported"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </InstrumentPanel>
  );
}
