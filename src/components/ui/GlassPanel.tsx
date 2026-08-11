import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** "strong" for higher-opacity glass (modals, command surfaces); "glow" adds an animated gradient border for hero panels. */
  variant?: "default" | "strong" | "glow";
}

export function GlassPanel({ className, variant = "default", ...props }: GlassPanelProps) {
  return (
    <div
      className={cn(
        variant === "strong" ? "glass-panel-strong" : "glass-panel",
        variant === "glow" && "glow-border",
        className
      )}
      {...props}
    />
  );
}
