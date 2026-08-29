import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * "strong" for surfaces nearest the viewer (modals, menus, command
   * surfaces); "glow" adds the gradient border for hero panels; "well" for
   * surfaces things sit INSIDE — canvases, scroll regions, feeds.
   */
  variant?: "default" | "strong" | "glow" | "well";
}

/**
 * The general-purpose VOX surface, built from the instrument material (see
 * the "Instrument layer" section of globals.css): a translucent housing, a
 * hairline of light along the top edge, a shaded underside, and a shadow
 * matched to how far the surface sits off the page.
 *
 * Routing this through the shared material rather than a per-screen style is
 * what makes the Dashboard, the Brain and the Lab read as rooms in one
 * environment. For the primary readout on a screen, reach for
 * InstrumentPanel with depth="raised" instead — this is the resting surface.
 */
export function GlassPanel({ className, variant = "default", ...props }: GlassPanelProps) {
  return (
    <div
      className={cn(
        variant === "strong" && "instrument-float instrument-sheen",
        variant === "well" && "instrument-well",
        (variant === "default" || variant === "glow") && "instrument instrument-sheen",
        variant === "glow" && "glow-border",
        className
      )}
      {...props}
    />
  );
}
