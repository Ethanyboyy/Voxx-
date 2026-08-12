"use client";

import { AskVoxPanel } from "@/components/brain/AskVoxPanel";
import type { BrainNode, BrainState } from "@/lib/brain/graph";

function field(node: BrainNode, key: string): string {
  const v = node.meta[key];
  if (v == null || v === "") return "Not set";
  return String(v);
}

const ROWS: { label: string; key: string }[] = [
  { label: "Value", key: "estimatedValue" },
  { label: "Effort", key: "effort" },
  { label: "Confidence", key: "confidence" },
  { label: "Risk", key: "risk" },
  { label: "Next action", key: "nextAction" },
];

/**
 * Side-by-side comparison of two opportunities using only their real
 * recorded fields — no invented comparison score. "Which is better" is left
 * to VOX's actual reasoning via the embedded Ask VOX panel, not a formula
 * pretending to be one.
 */
export function CompareView({
  a,
  b,
  onClose,
  onActivity,
}: {
  a: BrainNode;
  b: BrainNode;
  onClose: () => void;
  onActivity: (state: BrainState | null, detail: string | null) => void;
}) {
  const contextText = [
    `Comparing two opportunities directly.`,
    `A: "${a.label}" — status ${a.status}, value ${field(a, "estimatedValue")}, effort ${field(a, "effort")}, confidence ${field(a, "confidence")}, risk ${field(a, "risk")}, next action: ${field(a, "nextAction")}.`,
    `B: "${b.label}" — status ${b.status}, value ${field(b, "estimatedValue")}, effort ${field(b, "effort")}, confidence ${field(b, "confidence")}, risk ${field(b, "risk")}, next action: ${field(b, "nextAction")}.`,
  ].join(" ");

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Compare</p>
        <button type="button" onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close compare">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <p className="truncate text-sm font-semibold text-foreground">{a.label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{b.label}</p>
      </div>

      <div className="flex flex-col gap-2">
        {ROWS.map((row) => (
          <div key={row.key} className="rounded-lg border border-border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</p>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
              <p className="truncate text-foreground">{field(a, row.key)}</p>
              <p className="truncate text-foreground">{field(b, row.key)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <AskVoxPanel
          contextText={contextText}
          contextLabel={`${a.label} vs ${b.label}`}
          suggestedQuestions={["Which one is better and why?", "What's missing to decide confidently?"]}
          onActivity={onActivity}
        />
      </div>
    </div>
  );
}
