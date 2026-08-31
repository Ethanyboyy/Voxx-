"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { useEventStream } from "@/lib/events/useEventStream";
import { cn } from "@/lib/utils/cn";

/**
 * What a chat-started run is doing, inline in the conversation.
 *
 * NOT a second workspace. The division is deliberate: this answers "what is
 * happening right now", the workspace answers "what is the full record" —
 * artifacts, per-candidate scores, provider costs, lineage. Duplicating those
 * here would give a reader two surfaces that can disagree, so the panel
 * deliberately stops at the checklist and links onward.
 *
 * UPDATES COME FROM THE EXISTING EVENT STREAM. It refetches the trace only when
 * an event that could change this run arrives, so an idle run costs nothing and
 * a busy one costs one small read per real state change. There is no polling
 * loop and no fabricated tick.
 *
 * The server is authoritative. Everything rendered is read back from the run's
 * own rows, which is what makes a reload mid-run recover rather than restart.
 */

type RunStatus = "PLANNING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";
type StepStatus = "PENDING" | "RUNNING" | "WAITING_FOR_PERMISSION" | "COMPLETED" | "FAILED" | "SKIPPED";

interface TraceStep {
  order: number;
  description: string;
  status: StepStatus;
  error: string | null;
}

interface InlineTrace {
  runId: string | null;
  status: RunStatus | null;
  steps: TraceStep[];
  awaiting: { capability: string; requiredLevel: string; description: string } | null;
  iterations: { attempts: { attempt: number; status: "PASS" | "FAIL" | "RUNNING"; score: number | null }[]; limit: number }[];
  live: boolean;
}

/** Events that could change a run. Anything else is ignored, so an unrelated
 * memory write does not cause a read. */
const RELEVANT_PREFIXES = ["agent.", "capability.", "artifact.", "iteration."];

const STEP_MARK: Record<StepStatus, { glyph: string; className: string; label: string }> = {
  PENDING: { glyph: "○", className: "text-muted-foreground", label: "Waiting" },
  RUNNING: { glyph: "◐", className: "text-accent-blue", label: "Working" },
  WAITING_FOR_PERMISSION: { glyph: "◍", className: "text-warning", label: "Needs permission" },
  COMPLETED: { glyph: "✓", className: "text-success", label: "Done" },
  FAILED: { glyph: "✕", className: "text-danger", label: "Failed" },
  SKIPPED: { glyph: "–", className: "text-muted-foreground", label: "Skipped" },
};

const RUN_STATE: Record<RunStatus, { color: string; label: string; pulse: boolean }> = {
  PLANNING: { color: "var(--core-thinking)", label: "Planning", pulse: true },
  RUNNING: { color: "var(--accent-blue)", label: "Running", pulse: true },
  WAITING_FOR_PERMISSION: { color: "var(--warning)", label: "Needs permission", pulse: true },
  WAITING: { color: "var(--warning)", label: "Waiting", pulse: true },
  COMPLETED: { color: "var(--success)", label: "Done", pulse: false },
  FAILED: { color: "var(--danger)", label: "Failed", pulse: false },
  CANCELLED: { color: "var(--muted)", label: "Stopped", pulse: false },
};

export function InlineRunProgress({ runId, onSettled }: { runId: string; onSettled?: () => void }) {
  const [trace, setTrace] = useState<InlineTrace | null>(null);
  const [stopping, setStopping] = useState(false);
  /** Whether the parent has already been told this run reached a terminal state. */
  const reportedRef = useRef(false);
  // Held in a ref so `apply` does not have to change identity when the parent
  // re-renders, which would otherwise re-run the mount effect on every message
  // refresh — the very thing `onSettled` triggers.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  /**
   * Adopts a freshly read trace and reports a terminal run exactly once.
   *
   * Reporting on the FIRST non-live read, rather than on a live→settled
   * transition, is load-bearing: a short run (a single memory recall, or a plan
   * that degraded to nothing) can finish before this panel has even mounted, so
   * the transition being watched for has already happened. Waiting for it left
   * the message permanently reading "Working on it" while the server had long
   * since written the real outcome — visible only if you reloaded the page.
   */
  const apply = useCallback((next: InlineTrace) => {
    setTrace(next);
    if (!next.live && !reportedRef.current) {
      reportedRef.current = true;
      onSettledRef.current?.();
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/capabilities/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!response.ok) return null;
      const body = await response.json();
      return body.trace as InlineTrace;
    } catch {
      // A dropped read leaves the last known state on screen rather than
      // replacing it with an error — the run itself is unaffected.
      return null;
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    // Scheduled rather than called, so nothing sets state during the effect.
    const timer = setTimeout(async () => {
      const next = await load();
      if (!cancelled && next) apply(next);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, apply]);

  const onEvent = useCallback(
    (event: { type: string }) => {
      if (!RELEVANT_PREFIXES.some((p) => event.type.startsWith(p))) return;
      void (async () => {
        const next = await load();
        if (next) apply(next);
      })();
    },
    [load, apply],
  );
  useEventStream({ onEvent });

  async function stop() {
    setStopping(true);
    try {
      const response = await fetch(`/api/capabilities/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      if (response.ok) {
        const body = await response.json();
        if (body.trace) apply(body.trace as InlineTrace);
      }
    } finally {
      setStopping(false);
    }
  }

  if (!trace || !trace.status) return null;

  const state = RUN_STATE[trace.status];
  const done = trace.steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length;
  const canStop = ["PLANNING", "RUNNING", "WAITING_FOR_PERMISSION", "WAITING"].includes(trace.status);
  const loop = trace.iterations[0];

  return (
    <div className="instrument mt-2 max-w-full overflow-hidden rounded-md px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StateIndicator color={state.color} label={state.label} pulse={state.pulse} />
        <span className="vox-unit">
          {done} / {trace.steps.length}
        </span>
      </div>

      <ol className="mt-2 space-y-1">
        {trace.steps.map((step) => {
          const mark = STEP_MARK[step.status];
          return (
            <li key={step.order} className="flex items-start gap-2 text-xs leading-5">
              <span className={cn("w-3 shrink-0 text-center", mark.className)} aria-hidden="true">
                {mark.glyph}
              </span>
              {/* Clamped to two lines. A step description can embed the whole
                  request ("Recall what VOX already knows relevant to: …"),
                  which in a chat bubble restates the message directly above it
                  and pushes the rest of the panel off screen. The workspace
                  carries the untruncated text. */}
              <span className="line-clamp-2 min-w-0 flex-1 text-muted">
                <span className="sr-only">{mark.label}: </span>
                {step.description}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Attempts as "n of limit", never an open-ended loop. */}
      {loop && loop.attempts.length > 0 ? (
        <p className="vox-unit mt-2">
          {loop.attempts.map((a) => `${a.attempt}:${a.status === "RUNNING" ? "…" : (a.score ?? "—")}`).join("  ")}
          {"  "}·{"  "}attempt {loop.attempts.length} of {loop.limit}
        </p>
      ) : null}

      {trace.awaiting ? (
        <p className="mt-2 text-[11px] leading-relaxed text-warning">
          Needs {trace.awaiting.requiredLevel} on {trace.awaiting.capability} before it can continue.
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <a
          href={`/workspace/${runId}`}
          className="vox-unit underline underline-offset-2 hover:text-foreground"
        >
          Open the workspace →
        </a>
        {canStop ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={stopping}
            className="vox-unit underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
