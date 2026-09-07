"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * [P4-G] The Observer's shared vocabulary.
 *
 * These exist so the screen's truth rules are enforced by the components
 * rather than remembered at each call site. Three of them matter:
 *
 *   `Money` renders `null` as UNRECORDED, never as $0.00. "We earned nothing"
 *   and "we have no way to know" are different facts and the second one is
 *   usually the true one here.
 *
 *   `Provenance` labels every figure with what it actually is — recorded,
 *   reserved, requested or hypothetical — so a proposal can never be read as
 *   an outcome.
 *
 *   `Truthless` is the empty state, and it says what is absent rather than
 *   filling the space with something that looks like activity.
 *
 * Everything is built on the existing instrument tokens (globals.css). No new
 * product identity, no second design system.
 */

/** What a number IS. The single most important distinction on this screen. */
export type Provenance =
  /** In the ledger. Money that actually moved, as far as VOX was told. */
  | "RECORDED"
  /** Approved and set aside. Not spent. */
  | "RESERVED"
  /** An agent asked. Nobody has agreed. */
  | "REQUESTED"
  /** An estimate somebody wrote down. Not evidence of anything. */
  | "ESTIMATE"
  /** Derived from recorded rows by arithmetic. */
  | "DERIVED";

const PROVENANCE_STYLE: Record<Provenance, { label: string; tone: string }> = {
  RECORDED: { label: "Recorded", tone: "var(--success)" },
  RESERVED: { label: "Reserved", tone: "var(--accent)" },
  REQUESTED: { label: "Requested", tone: "var(--warning)" },
  ESTIMATE: { label: "Estimate", tone: "var(--accent-steel)" },
  DERIVED: { label: "Derived", tone: "var(--accent-blue)" },
};

export function ProvenanceTag({ kind, className }: { kind: Provenance; className?: string }) {
  const style = PROVENANCE_STYLE[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
        className
      )}
      style={{ borderColor: `color-mix(in srgb, ${style.tone} 35%, transparent)`, color: style.tone }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: style.tone }} />
      {style.label}
    </span>
  );
}

/**
 * A cents figure.
 *
 * `null` becomes UNRECORDED, never zero. This is the component-level
 * expression of the phase's governing rule: if the runtime does not know a
 * number, the screen must not print one.
 */
export function Money({
  cents,
  className,
  emphasis = false,
}: {
  cents: number | null | undefined;
  className?: string;
  emphasis?: boolean;
}) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return <span className={cn("vox-unit text-muted-foreground", className)}>UNRECORDED</span>;
  }
  const negative = cents < 0;
  const value = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <span
      className={cn(
        "tabular-nums",
        emphasis && "vox-headline",
        negative && "text-[var(--danger)]",
        className
      )}
    >
      {negative ? "−" : ""}${value}
    </span>
  );
}

/** A ratio, or nothing. Same rule as Money: no basis means no number. */
export function Ratio({
  value,
  className,
  suffix = "%",
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("vox-unit text-muted-foreground", className)}>NO BASIS</span>;
  }
  return (
    <span className={cn("tabular-nums", className)}>
      {(value * 100).toFixed(1)}
      {suffix}
    </span>
  );
}

/**
 * The truthful empty state.
 *
 * Takes the exact sentence to show, because a generic "Nothing here yet" hides
 * which of several different absences this is — no runtime, no capital, no
 * decisions pending — and those mean very different things to a reader.
 */
export function Truthless({ label, detail, className }: { label: string; detail?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-border px-5 py-9 text-center",
        className
      )}
    >
      <p className="vox-unit text-muted">{label}</p>
      {detail ? <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/** Agent lifecycle state → the existing core-state tokens. Never decorative. */
export const RUNTIME_STATE_COLOR: Record<string, string> = {
  IDLE: "var(--core-idle)",
  THINKING: "var(--core-thinking)",
  RESEARCHING: "var(--core-listening)",
  EVALUATING: "var(--core-thinking)",
  PROPOSING: "var(--core-responding)",
  WAITING_FOR_AUTHORIZATION: "var(--core-waiting)",
  EXECUTING: "var(--core-executing)",
  REPORTING: "var(--core-listening)",
  LEARNING: "var(--core-2)",
  PAUSED: "var(--muted)",
  FAILED: "var(--core-error)",
  SUSPENDED: "var(--danger)",
};

/** States where something is genuinely in flight — the only ones allowed to glow. */
export const ACTIVE_STATES = new Set([
  "THINKING",
  "RESEARCHING",
  "EVALUATING",
  "PROPOSING",
  "EXECUTING",
  "REPORTING",
  "LEARNING",
]);

export function stateColor(state: string): string {
  return RUNTIME_STATE_COLOR[state] ?? "var(--muted)";
}

/** A small labelled chip. Tone must come from real state, never from taste. */
export function Chip({
  children,
  tone = "var(--muted)",
  className,
  title,
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
        className
      )}
      style={{
        borderColor: `color-mix(in srgb, ${tone} 30%, transparent)`,
        background: `color-mix(in srgb, ${tone} 8%, transparent)`,
        color: tone,
      }}
    >
      {children}
    </span>
  );
}

/** Monospace id, truncated, with the full value on hover and for copy. */
export function IdTag({ id, className, label }: { id: string; className?: string; label?: string }) {
  return (
    <span
      title={id}
      className={cn("font-mono text-[10px] tracking-tight text-muted-foreground", className)}
    >
      {label ? `${label} ` : ""}
      {id.slice(0, 8)}
    </span>
  );
}

function relative(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * Relative time from an ISO string.
 *
 * `Date.now()` is read in an effect rather than during render, for two
 * independent reasons: reading a clock while rendering is impure and makes the
 * output non-deterministic, and the server and the client would compute
 * different strings from it, which is a hydration mismatch. So the first paint
 * is the absolute timestamp — true on both sides — and it becomes relative once
 * mounted, ticking every 30 seconds so an "8s ago" does not sit there for an
 * hour claiming to be fresh.
 */
export function Ago({ at, className }: { at: string | null | undefined; className?: string }) {
  const parsed = at ? new Date(at).getTime() : Number.NaN;
  const valid = Number.isFinite(parsed);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    const tick = () => setText(relative(parsed, Date.now()));
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [parsed, valid]);

  if (!at) return <span className={cn("vox-unit text-muted-foreground", className)}>NEVER</span>;
  if (!valid) return <span className={cn("vox-unit text-muted-foreground", className)}>—</span>;

  return (
    <time dateTime={at} title={new Date(at).toLocaleString()} className={cn("tabular-nums", className)}>
      {text ?? new Date(at).toISOString().slice(11, 19)}
    </time>
  );
}

/**
 * A stage in the capital pipeline.
 *
 * `reached: false` renders as NOT YET OCCURRED rather than as an empty slot,
 * which is §9's requirement applied to the pipeline as well as the trace: a
 * stage that has not happened must look different from one that has.
 */
export function PipelineStage({
  label,
  reached,
  value,
  detail,
  tone,
}: {
  label: string;
  reached: boolean;
  value?: ReactNode;
  detail?: ReactNode;
  tone: string;
}) {
  return (
    <li
      className={cn(
        "relative flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-xs)] border px-3 py-2.5 transition-colors duration-500",
        reached ? "border-[var(--instrument-border-lit)]" : "border-dashed border-border"
      )}
      style={reached ? { background: `color-mix(in srgb, ${tone} 7%, transparent)` } : undefined}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: reached ? tone : "var(--border-strong)" }}
        />
        <span className="vox-unit truncate">{label}</span>
      </span>
      {reached ? (
        <>
          <span className="text-sm font-medium text-foreground">{value}</span>
          {detail ? <span className="truncate text-[11px] text-muted-foreground">{detail}</span> : null}
        </>
      ) : (
        <span className="vox-unit text-muted-foreground">NOT YET OCCURRED</span>
      )}
    </li>
  );
}
