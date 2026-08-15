"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { ConfidenceTag } from "@/components/lab/primitives";

export interface InspectionNode {
  id: string;
  name: string;
  description: string | null;
  materialName: string | null;
  massKg: number | null;
  notes: string | null;
  confidence: string;
  children: InspectionNode[];
}

/** Fallout-style progressive component inspection: click a layer to expand
 * into its children and reveal its own data — reused identically by both
 * Suit Bay and Engineering Bay since both hang off the same LabComponent tree. */
export function HolographicInspectionTree({ nodes }: { nodes: InspectionNode[] }) {
  const [selected, setSelected] = useState<InspectionNode | null>(null);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted">No components recorded yet for this design.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1">
        {nodes.map((n) => (
          <TreeRow key={n.id} node={n} depth={0} selected={selected} onSelect={setSelected} />
        ))}
      </div>
      <div className="glass-panel p-4">
        {selected ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">{selected.name}</h4>
              <ConfidenceTag confidence={selected.confidence} />
            </div>
            <p className="text-sm text-muted">{selected.description ?? "No description recorded."}</p>
            <dl className="mt-2 space-y-1 text-xs">
              {selected.materialName ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Material</dt>
                  <dd className="text-foreground">{selected.materialName}</dd>
                </div>
              ) : null}
              {selected.massKg != null ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Mass</dt>
                  <dd className="lab-mono text-foreground">{selected.massKg} kg</dd>
                </div>
              ) : null}
            </dl>
            {selected.notes ? <p className="mt-2 border-t border-border pt-2 text-xs text-muted">{selected.notes}</p> : null}
            {selected.children.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{selected.children.length} sub-component(s) — expand in the tree.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Select a component to inspect it.</p>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: InspectionNode;
  depth: number;
  selected: InspectionNode | null;
  onSelect: (n: InspectionNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect(node);
          if (hasChildren) setOpen((v) => !v);
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          selected?.id === node.id ? "bg-accent-muted text-accent" : "text-muted hover:bg-surface-hover hover:text-foreground"
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {hasChildren ? <span className="lab-mono w-3 text-xs opacity-60">{open ? "▾" : "▸"}</span> : <span className="w-3" />}
        <span className="flex-1 truncate">{node.name}</span>
        {node.massKg != null ? <span className="lab-mono text-[10px] text-muted-foreground">{node.massKg}kg</span> : null}
      </button>
      {open && hasChildren
        ? node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)
        : null}
    </div>
  );
}
