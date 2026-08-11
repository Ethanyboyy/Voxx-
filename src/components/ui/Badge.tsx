import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-hover text-muted-foreground border border-border",
  accent: "bg-accent-muted text-accent border border-[var(--border-strong)] shadow-[0_0_10px_-4px_var(--accent)]",
  success: "bg-success/10 text-success border border-success/30",
  warning: "bg-warning/10 text-warning border border-warning/30",
  danger: "bg-danger-muted text-danger border border-danger/30",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}

const CONFIDENCE_TONE: Record<string, Tone> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "accent",
  CONFIRMED: "success",
};

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <Badge tone={CONFIDENCE_TONE[confidence] ?? "neutral"} title="Confidence level — never silently upgraded">
      {confidence.toLowerCase()}
    </Badge>
  );
}
