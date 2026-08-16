"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils/cn";
import type { BrainNode } from "@/lib/brain/graph";

interface ActivityEvent {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

type RangeOption = "today" | "yesterday" | "7days" | "custom" | "all";

const RANGE_LABEL: Record<Exclude<RangeOption, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7days": "Last 7 days",
  all: "All",
};

// Only real Event subjectType strings this app ever records, mapped to the
// Brain's node id prefixes — everything else (BrainGroup, Decision,
// Experiment, Goal, ResearchQuery, ...) simply isn't a graph node, so those
// events render as plain (non-clickable) text rather than a broken link.
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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * What VOX has actually been doing — the same Event rows the Command Center
 * and Activity page read, just presented as the Brain's "activity"
 * perspective since a chronological log isn't a spatial graph. Filtering by
 * date range and clicking through to the affected entity both operate on
 * this same real Event stream — nothing here is synthesized.
 */
export function ActivityTimeline({
  events,
  nodes,
  onSelectNode,
}: {
  events: ActivityEvent[];
  nodes?: BrainNode[];
  onSelectNode?: (nodeId: string) => void;
}) {
  const [range, setRange] = useState<RangeOption>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const filtered = useMemo(() => {
    if (range === "all") return events;
    const now = new Date();
    let start: Date;
    let end: Date;
    if (range === "today") {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (range === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      start = startOfDay(y);
      end = endOfDay(y);
    } else if (range === "7days") {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      start = startOfDay(s);
      end = endOfDay(now);
    } else {
      if (!customFrom && !customTo) return events;
      start = customFrom ? startOfDay(new Date(customFrom)) : new Date(0);
      end = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
    }
    return events.filter((e) => {
      const t = new Date(e.createdAt);
      return t >= start && t <= end;
    });
  }, [events, range, customFrom, customTo]);

  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden p-6">
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {(Object.keys(RANGE_LABEL) as Exclude<RangeOption, "custom">[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              "vox-press rounded-full border px-2.5 py-1 text-xs transition-colors duration-200 ease-[var(--ease-luxury)]",
              range === r ? "border-accent bg-accent-muted/40 text-accent" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRange("custom")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs",
            range === "custom" ? "border-accent bg-accent-muted/40 text-accent" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          Custom
        </button>
        {range === "custom" ? (
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground"
            />
          </span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title={events.length === 0 ? "Nothing recorded yet" : "Nothing in this range"}
            description={events.length === 0 ? "Activity shows up here as VOX does real things." : "Try a wider range."}
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-3 overflow-y-auto scrollbar-thin border-l border-border pl-4">
          {filtered.map((e) => {
            const nodeType = e.subjectType ? SUBJECT_TO_NODE_TYPE[e.subjectType] : undefined;
            const targetId = nodeType && e.subjectId ? `${nodeType}:${e.subjectId}` : null;
            const target = targetId ? byId.get(targetId) : undefined;
            const clickable = Boolean(target && onSelectNode);
            return (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onSelectNode!(target!.id)}
                    className="text-left text-foreground hover:text-accent hover:underline"
                  >
                    {e.type.replace(/[._]/g, " ")}
                  </button>
                ) : (
                  <span className="text-foreground">{e.type.replace(/[._]/g, " ")}</span>
                )}
                {e.subjectType ? (
                  <Badge className="ml-2" tone="neutral">
                    {e.subjectType.toLowerCase()}
                  </Badge>
                ) : null}
                <span className="ml-2 text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
