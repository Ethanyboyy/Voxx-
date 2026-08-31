/**
 * Client-side reporter for Suit Bay interactions.
 *
 * Fire-and-forget by design. A recording failure must never break, block or
 * even slow the interaction it is recording — the user selecting a suit is the
 * real event, and the audit row is a consequence of it, not a precondition.
 * So this returns void, swallows transport failures, and is safe to call
 * directly from an event handler.
 *
 * It deliberately does NOT retry. A dropped selection is a missing line in a
 * timeline; a retry storm from a 3D surface that fires on every tap is a real
 * problem.
 */

import type { SuitInteraction } from "@/lib/lab/interactions";

export interface InteractionReport {
  type: SuitInteraction;
  suitId?: string;
  componentId?: string;
  amount?: number;
}

export function reportSuitInteraction(report: InteractionReport): void {
  // No window means SSR or a test renderer; there is nothing to report from.
  if (typeof window === "undefined") return;

  void fetch("/api/lab/suits/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {
    // Intentionally silent. See the module docstring.
  });
}
