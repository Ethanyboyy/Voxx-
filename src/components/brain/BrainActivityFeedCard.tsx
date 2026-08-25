"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { SYSTEM_COLOR, SUBJECT_TYPE_TO_SYSTEM } from "@/components/brain/three/anatomy";
import type { BrainNode } from "@/lib/brain/graph";

interface ActivityEvent {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

const SUBJECT_TO_NODE_TYPE: Record<string, BrainNode["type"]> = {
  Objective: "OBJECTIVE",
  Opportunity: "OPPORTUNITY",
  Project: "PROJECT",
  Task: "TASK",
  Memory: "MEMORY",
  Proposal: "PROPOSAL",
  Connection: "CONNECTION",
  AgentRun: "AGENT_RUN",
};

/** Real elapsed time since a real Event's createdAt — never a fabricated tick. */
export function formatRelativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/**
 * `Date.now()` differs between the server-rendered HTML and the client's
 * first paint, so computing formatRelativeTime() directly during render is
 * a real hydration mismatch (confirmed via a live SSR warning, not a
 * hypothetical). Deferring the computation into an effect — and re-running
 * it every second so "4s ago" actually keeps ticking — avoids that: both
 * server and the client's first render show the same placeholder, and the
 * real value only ever lands after mount.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    function tick() {
      setLabel(formatRelativeTime(iso));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <>{label ?? "…"}</>;
}

/**
 * A compact, always-on preview of the same real Event stream ActivityTimeline
 * shows full-screen — the reference's persistent bottom-corner "Activity
 * Feed" HUD card. Deliberately small (4 items): this is a glance surface,
 * not a replacement for the full timeline "View All Activity" still opens.
 */
export function BrainActivityFeedCard({
  events,
  nodes,
  liveStatus,
  onSelectNode,
  onViewAll,
}: {
  events: ActivityEvent[];
  nodes: BrainNode[];
  liveStatus: string;
  onSelectNode: (id: string) => void;
  onViewAll: () => void;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const recent = events.slice(0, 4);

  return (
    <div className="glass-panel-strong flex w-full flex-col gap-2.5 rounded-[var(--radius-md)] p-3.5 sm:w-72">
      <div className="flex items-center justify-between">
        <span className="vox-eyebrow text-[10px]">Activity Feed</span>
        <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 rounded-full", liveStatus === "open" ? "bg-success" : "bg-muted-foreground")} />
          {liveStatus === "open" ? "Live" : liveStatus === "connecting" ? "Connecting" : "Offline"}
        </span>
      </div>

      {recent.length === 0 ? (
        <p className="text-xs text-muted">Nothing recorded yet this session.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recent.map((e) => {
            const nodeType = e.subjectType ? SUBJECT_TO_NODE_TYPE[e.subjectType] : undefined;
            const targetId = nodeType && e.subjectId ? `${nodeType}:${e.subjectId}` : null;
            const target = targetId ? byId.get(targetId) : undefined;
            const system = e.subjectType ? SUBJECT_TYPE_TO_SYSTEM[e.subjectType] : undefined;
            const color = system ? SYSTEM_COLOR[system] : "#8b86a8";
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  {target ? (
                    <button type="button" onClick={() => onSelectNode(target.id)} className="block truncate text-left font-medium text-foreground hover:text-accent">
                      {target.label}
                    </button>
                  ) : (
                    <span className="block truncate font-medium text-foreground">{e.type.replace(/[._]/g, " ")}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {e.type.replace(/[._]/g, " ")} · <RelativeTime iso={e.createdAt} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={onViewAll} className="lab-mono self-start text-[10px] uppercase tracking-wider text-accent hover:underline">
        View all activity →
      </button>
    </div>
  );
}
