import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const CONFIDENCE_LABEL: Record<string, string> = {
  VERIFIED: "Verified",
  ESTIMATED: "Estimated",
  HYPOTHETICAL: "Hypothetical",
  UNKNOWN: "Unknown",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  VERIFIED: "text-success border-success/40 bg-success/10",
  ESTIMATED: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  HYPOTHETICAL: "text-warning border-warning/40 bg-warning/10",
  UNKNOWN: "text-muted-foreground border-border bg-surface-hover",
};

/** Source/confidence tag for engineering data — visible in Engineering/Everything
 * mode. Never decorative: the label always mirrors the record's real LabConfidence. */
export function ConfidenceTag({ confidence, className }: { confidence: string; className?: string }) {
  return (
    <span
      className={cn(
        "lab-mono inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        CONFIDENCE_CLASS[confidence] ?? CONFIDENCE_CLASS.UNKNOWN,
        className
      )}
    >
      {CONFIDENCE_LABEL[confidence] ?? confidence}
    </span>
  );
}

const REALITY_STATUS_LABEL: Record<string, string> = {
  REAL: "Real — built",
  BUILDABLE: "Buildable today",
  PROTOTYPE: "Prototype",
  EXPERIMENTAL: "Experimental",
  CONCEPT: "Concept",
  NOT_CONNECTED: "Not connected",
};

const REALITY_STATUS_CLASS: Record<string, string> = {
  REAL: "text-success border-success/40 bg-success/10",
  BUILDABLE: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  PROTOTYPE: "text-accent border-[var(--border-strong)] bg-accent-muted",
  EXPERIMENTAL: "text-warning border-warning/40 bg-warning/10",
  CONCEPT: "text-muted-foreground border-border bg-surface-hover",
  NOT_CONNECTED: "text-danger border-danger/40 bg-danger-muted",
};

/** Buildability/reality axis tag — a suit's honest answer to "could this
 * exist," independent of ConfidenceTag (evidence quality) and
 * LabStatusBadge (workflow state). Never decorative: always mirrors the
 * record's real LabRealityStatus, defaulting to CONCEPT — see schema.prisma. */
export function RealityStatusTag({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "lab-mono inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        REALITY_STATUS_CLASS[status] ?? REALITY_STATUS_CLASS.CONCEPT,
        className
      )}
    >
      {REALITY_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export interface HolographicPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "strong" | "glow";
  corners?: boolean;
  scanline?: boolean;
}

/** Base panel surface for the Laboratory — reuses VOX's existing glass-panel
 * system (already purple/cyan on near-black, matching the requested palette)
 * with optional corner brackets + scanline for a more "equipment inspection"
 * feel on hero surfaces. */
export function HolographicPanel({
  className,
  variant = "default",
  corners = false,
  scanline = false,
  children,
  ...props
}: HolographicPanelProps) {
  return (
    <div
      className={cn(
        "relative",
        variant === "strong" ? "glass-panel-strong" : "glass-panel",
        variant === "glow" && "glow-border",
        corners && "lab-corner-frame",
        className
      )}
      {...props}
    >
      {scanline ? <div className="lab-scanline" /> : null}
      {children}
    </div>
  );
}

export function LabSectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("lab-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80", className)}>
      {children}
    </p>
  );
}

const STAT_META: Record<string, { label: string; unit?: string; invert?: boolean }> = {
  stealth: { label: "Stealth" },
  durability: { label: "Durability" },
  mobility: { label: "Mobility" },
  stretchiness: { label: "Stretchiness" },
  protection: { label: "Protection" },
  environmentalResistance: { label: "Environmental Resistance" },
  manufacturingComplexity: { label: "Manufacturing Complexity", invert: true },
  flexibility: { label: "Flexibility" },
  impactResistance: { label: "Impact Resistance" },
  visibility: { label: "Visibility", invert: true },
  noiseProfile: { label: "Noise Profile", invert: true },
  sensorCapacity: { label: "Sensor Capacity" },
  maintenanceComplexity: { label: "Maintenance Complexity", invert: true },
  durabilityGadget: { label: "Durability" },
  sensorAccuracy: { label: "Sensor Accuracy" },
  reliability: { label: "Reliability" },
};

/** A single 0-100 stat as a labeled bar. `invert` stats (complexity, noise,
 * visibility) render in warning tones when high rather than accent tones. */
export function StatBar({ statKey, value }: { statKey: string; value: number }) {
  const meta = STAT_META[statKey] ?? { label: statKey };
  const pct = Math.max(0, Math.min(100, value));
  const warn = meta.invert && pct > 60;
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 shrink-0 truncate text-xs text-muted">{meta.label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", warn ? "bg-warning" : "bg-gradient-to-r from-accent-blue to-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="lab-mono w-9 shrink-0 text-right text-xs text-foreground">{Math.round(pct)}</span>
    </div>
  );
}

export function UnitStat({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="lab-mono text-foreground">
        {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
        {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "text-accent border-[var(--border-strong)] bg-accent-muted",
  EXPERIMENTAL: "text-warning border-warning/40 bg-warning/10",
  PREFERRED: "text-success border-success/40 bg-success/10",
  ARCHIVED: "text-muted-foreground border-border bg-surface-hover",
  PLANNED: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  RUNNING: "text-warning border-warning/40 bg-warning/10",
  COMPLETED: "text-success border-success/40 bg-success/10",
  FAILED: "text-danger border-danger/40 bg-danger-muted",
  ABANDONED: "text-muted-foreground border-border bg-surface-hover",
};

export function LabStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "lab-mono inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        STATUS_CLASS[status] ?? "text-muted-foreground border-border bg-surface-hover"
      )}
    >
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

export function SafetyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </div>
  );
}
