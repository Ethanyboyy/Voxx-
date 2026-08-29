"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { ConfidenceTag, RealityStatusTag } from "@/components/lab/primitives";

const SUBSYSTEM_LABEL: Record<string, string> = {
  HEAD: "Head",
  TORSO: "Torso",
  ARMS: "Arms",
  LEGS: "Legs",
  FEET: "Feet",
  CORE: "Core",
};

const RISK_CLASS: Record<string, string> = {
  LOW: "text-success border-success/40 bg-success/10",
  MODERATE: "text-warning border-warning/40 bg-warning/10",
  HIGH: "text-danger border-danger/40 bg-danger-muted",
  UNKNOWN: "text-muted-foreground border-border bg-surface-hover",
};

export interface InspectionDependencyRef {
  id: string;
  dependsOnId: string;
  dependsOnName: string;
  note: string | null;
}

export interface InspectionNode {
  id: string;
  name: string;
  description: string | null;
  materialName: string | null;
  massKg: number | null;
  notes: string | null;
  confidence: string;
  subsystem?: string | null;
  powerDrawW?: number | null;
  costUsd?: number | null;
  riskLevel?: string;
  realityStatus?: string;
  dependsOn?: InspectionDependencyRef[];
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
      <div className="instrument instrument-sheen p-4">
        {selected ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">{selected.name}</h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {selected.subsystem ? (
                  <span className="lab-mono rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {SUBSYSTEM_LABEL[selected.subsystem] ?? selected.subsystem}
                  </span>
                ) : null}
                {selected.realityStatus ? <RealityStatusTag status={selected.realityStatus} /> : null}
                <ConfidenceTag confidence={selected.confidence} />
              </div>
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
              {selected.powerDrawW != null ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Power draw</dt>
                  <dd className="lab-mono text-foreground">{selected.powerDrawW} W</dd>
                </div>
              ) : null}
              {selected.costUsd != null ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="lab-mono text-foreground">${selected.costUsd.toLocaleString()}</dd>
                </div>
              ) : null}
              {selected.riskLevel ? (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Risk</dt>
                  <dd>
                    <span className={cn("lab-mono rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", RISK_CLASS[selected.riskLevel] ?? RISK_CLASS.UNKNOWN)}>
                      {selected.riskLevel}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
            {selected.dependsOn && selected.dependsOn.length > 0 ? (
              <div className="mt-2 border-t border-border pt-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Depends on</p>
                <ul className="mt-1 space-y-0.5">
                  {selected.dependsOn.map((d) => (
                    <li key={d.id} className="text-xs text-foreground">
                      {d.dependsOnName}
                      {d.note ? <span className="text-muted"> — {d.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
        {node.subsystem ? (
          <span className="lab-mono shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {SUBSYSTEM_LABEL[node.subsystem] ?? node.subsystem}
          </span>
        ) : null}
        {node.massKg != null ? <span className="lab-mono text-[10px] text-muted-foreground">{node.massKg}kg</span> : null}
      </button>
      {open && hasChildren
        ? node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)
        : null}
    </div>
  );
}
