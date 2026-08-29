"use client";

import { SYSTEM_COLOR, SYSTEM_OF } from "@/components/brain/three/anatomy";
import { RelativeTime } from "@/components/brain/BrainActivityFeedCard";
import type { BrainNode } from "@/lib/brain/graph";

/**
 * A compact, always-on summary of whatever is currently selected — the
 * reference's persistent bottom-corner "Inspector" HUD card. Every field is
 * real graph data (the node's own type/status/updatedAt, and its actual
 * edge count as "Connections") — never a fabricated metric like a fake
 * neuron count. "Open Full Analysis" opens the full InspectorPanel, which
 * carries the real type-specific detail and actions this compact card
 * deliberately leaves out.
 */
export function BrainInspectorCard({
  node,
  relatedNodes,
  onSelectNode,
  onOpenFull,
}: {
  node: BrainNode | null;
  relatedNodes: BrainNode[];
  onSelectNode: (id: string) => void;
  onOpenFull: () => void;
}) {
  if (!node) {
    return (
      <div className="instrument-float instrument-sheen flex w-full flex-col gap-1.5 rounded-[var(--radius-md)] p-3.5 sm:w-72">
        <span className="vox-eyebrow text-[10px]">Inspector</span>
        <p className="text-xs text-muted">Select anything in the graph to inspect it here.</p>
      </div>
    );
  }

  return (
    <div className="instrument-float instrument-sheen flex w-full flex-col gap-2.5 rounded-[var(--radius-md)] p-3.5 sm:w-72">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SYSTEM_COLOR[SYSTEM_OF[node.type]] }} />
        <span className="vox-eyebrow truncate text-[10px]">{node.label}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Type</dt>
        <dd className="text-right text-foreground">{node.type.toLowerCase().replace(/_/g, " ")}</dd>
        {node.status ? (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right text-foreground">{node.status.toLowerCase().replace(/_/g, " ")}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Connections</dt>
        <dd className="text-right text-foreground">{relatedNodes.length}</dd>
        <dt className="text-muted-foreground">Last updated</dt>
        <dd className="text-right text-foreground">
          <RelativeTime iso={node.updatedAt} />
        </dd>
      </dl>

      {relatedNodes.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Related</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {relatedNodes.slice(0, 8).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n.id)}
                title={n.label}
                className="h-3 w-3 rounded-full ring-1 ring-transparent transition-shadow hover:ring-white/40"
                style={{ background: SYSTEM_COLOR[SYSTEM_OF[n.type]] }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <button type="button" onClick={onOpenFull} className="lab-mono self-start text-[10px] uppercase tracking-wider text-accent hover:underline">
        Open full analysis →
      </button>
    </div>
  );
}
