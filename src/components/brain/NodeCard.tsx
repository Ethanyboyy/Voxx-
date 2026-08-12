"use client";

import { cn } from "@/lib/utils/cn";
import type { BrainNode } from "@/lib/brain/graph";

const TYPE_ACCENT: Record<string, string> = {
  OBJECTIVE: "var(--accent)",
  OPPORTUNITY: "var(--core-thinking)",
  PROJECT: "var(--accent-blue)",
  TASK: "var(--core-listening)",
  RESEARCH: "var(--core-executing)",
  PROPOSAL: "var(--warning)",
  CONNECTION: "var(--core-success)",
  MEMORY: "var(--border-strong)",
};

const TYPE_LABEL: Record<string, string> = {
  OBJECTIVE: "Objective",
  OPPORTUNITY: "Opportunity",
  PROJECT: "Project",
  TASK: "Task",
  RESEARCH: "Research",
  PROPOSAL: "Proposal",
  CONNECTION: "Connection",
  MEMORY: "Memory",
};

function subtitle(node: BrainNode): string | null {
  switch (node.type) {
    case "OBJECTIVE": {
      const target = node.meta.targetValue as number | null;
      const current = node.meta.currentValue as number | null;
      const unit = (node.meta.targetUnit as string | null) ?? "";
      return target != null ? `${current ?? 0} / ${target} ${unit}`.trim() : (node.status ?? null);
    }
    case "OPPORTUNITY": {
      const value = node.meta.estimatedValue as number | null;
      const effort = node.meta.effort as string | null;
      const parts = [value != null ? `${value} value` : null, effort ? `${effort.toLowerCase()} effort` : null].filter(
        Boolean
      );
      return parts.length > 0 ? parts.join(" · ") : (node.status ?? null);
    }
    case "TASK":
      return (node.meta.priority as string | null)?.toLowerCase() ?? null;
    case "RESEARCH":
      return (node.meta.provider as string | null) ?? null;
    case "MEMORY":
      return (node.meta.confidence as string | null)?.toLowerCase() ?? null;
    default:
      return node.status ? node.status.toLowerCase().replace(/_/g, " ") : null;
  }
}

/**
 * Three real levels of detail, driven by zoom scale (overview/explore) or by
 * being the current focus anchor (focus) — not decorative tiers, each one
 * shows strictly more of the same underlying fields as you get closer.
 */
export type NodeLOD = "overview" | "explore" | "focus";

export function NodeCard({
  node,
  x,
  y,
  selected,
  dimmed,
  pinned,
  lod,
  relationshipCount,
  onSelect,
  onFocusRequest,
  onPointerDownNode,
}: {
  node: BrainNode;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  pinned: boolean;
  lod: NodeLOD;
  relationshipCount: number;
  onSelect: (node: BrainNode) => void;
  onFocusRequest: (node: BrainNode) => void;
  onPointerDownNode: (e: React.PointerEvent, node: BrainNode) => void;
}) {
  const accent = TYPE_ACCENT[node.type] ?? "var(--accent)";
  const isHero = node.type === "OBJECTIVE";
  const isNBA = node.type === "OPPORTUNITY" && Boolean(node.meta.isNextBestAction);
  const sub = subtitle(node);
  const compact = lod === "overview";
  const focused = lod === "focus";

  return (
    <div
      role="button"
      tabIndex={0}
      data-node-id={node.id}
      onPointerDown={(e) => onPointerDownNode(e, node)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocusRequest(node);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(node);
      }}
      className={cn(
        "absolute flex select-none flex-col justify-center rounded-xl border px-3 py-2 text-left shadow-lg backdrop-blur-md transition-[opacity,left,top,transform,box-shadow] duration-300 ease-out",
        "bg-[color-mix(in_srgb,var(--surface-solid)_88%,transparent)]",
        selected ? "z-30 border-[var(--border-strong)]" : "z-10 border-border"
      )}
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${selected ? 1.05 : 1})`,
        width: compact ? 84 : focused ? 232 : isHero ? 200 : 168,
        minHeight: compact ? 34 : focused ? 116 : isHero ? 92 : 66,
        opacity: dimmed ? 0.16 : 1,
        boxShadow: selected
          ? `0 0 0 1px ${accent}, 0 0 30px -4px ${accent}`
          : isNBA
            ? `0 0 18px -6px ${accent}`
            : undefined,
        cursor: "pointer",
      }}
    >
      {pinned ? (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[9px]"
          title="Pinned"
        >
          📌
        </span>
      ) : null}
      {!compact ? (
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
            {TYPE_LABEL[node.type]}
          </span>
          {isNBA ? (
            <span className="ml-auto shrink-0 rounded-full bg-accent-muted px-1.5 py-0.5 text-[9px] font-semibold text-accent">
              next
            </span>
          ) : null}
        </div>
      ) : null}
      <p
        className={cn(
          "truncate font-medium text-foreground",
          compact ? "text-[10px]" : focused ? "text-base" : isHero ? "text-sm" : "text-xs"
        )}
      >
        {node.label}
      </p>
      {!compact && sub ? (
        <p className={cn("mt-0.5 truncate text-muted", focused ? "text-xs" : "text-[10px]")}>{sub}</p>
      ) : null}
      {(focused || (!compact && relationshipCount > 0)) && !compact ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {relationshipCount} relationship{relationshipCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
