"use client";

import { cn } from "@/lib/utils/cn";
import type { BrainState } from "@/lib/brain/graph";

const STATE_COLOR: Record<BrainState, string> = {
  idle: "var(--muted-foreground)",
  thinking: "var(--core-thinking)",
  researching: "var(--core-executing)",
  executing: "var(--core-executing)",
  waiting: "var(--warning)",
  learning: "var(--core-listening)",
  error: "var(--danger)",
};

const STATE_LABEL: Record<BrainState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  researching: "Researching",
  executing: "Executing",
  waiting: "Waiting for you",
  learning: "Learning",
  error: "Error",
};

export function BrainStateBadge({ state, detail }: { state: BrainState; detail: string | null }) {
  const color = STATE_COLOR[state];
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-[var(--surface-solid)]/80 px-3 py-1.5 backdrop-blur-md">
      <span className="relative flex h-2 w-2">
        <span
          className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", state !== "idle" && "vox-status-dot")}
          style={{ background: color }}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="text-xs font-medium text-foreground">{STATE_LABEL[state]}</span>
      {detail ? <span className="max-w-[220px] truncate text-xs text-muted">{detail}</span> : null}
    </div>
  );
}
