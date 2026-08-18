"use client";

import { cn } from "@/lib/utils/cn";

/**
 * Generic pulsing state dot + label, extracted from BrainStateBadge so any
 * subsystem that has a real state machine behind it (Brain, and later the
 * connectivity indicator — LOCAL/CONNECTED/DEGRADED/OFFLINE) renders it the
 * same way. Never decorative: callers must pass a real state, not a
 * fabricated animation cycle.
 */
export function StateIndicator({
  color,
  label,
  detail,
  pulse = true,
  className,
}: {
  /** A CSS color value (var(--core-thinking), var(--danger), etc.). */
  color: string;
  label: string;
  detail?: string | null;
  /** Whether the dot pulses — false for a settled/idle state. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-[var(--surface-solid)]/80 px-3 py-1.5 shadow-[var(--shadow-ambient-xs)] backdrop-blur-md",
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", pulse && "vox-status-dot")}
          style={{ background: color }}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {detail ? <span className="max-w-[220px] truncate text-xs text-muted">{detail}</span> : null}
    </div>
  );
}
