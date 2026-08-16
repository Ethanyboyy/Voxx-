"use client";

import { useState } from "react";
import { ConfidenceBadge } from "@/components/ui/Badge";

export interface ContextTrace {
  memoriesUsed: { id: string; content: string; confidence: string; similarity: number }[];
  assumptions: string[];
}

/**
 * Renders exactly the structured, auditable record buildSystemPrompt()
 * produced for this response — never hidden chain-of-thought, just which
 * memories fed the answer, at what confidence and relevance. See
 * PHASE_2_ARCHITECTURE.md §6.
 */
export function ContextPanel({ trace }: { trace: ContextTrace }) {
  const [open, setOpen] = useState(false);

  if (trace.memoriesUsed.length === 0 && trace.assumptions.length === 0) {
    return (
      <button onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-muted hover:text-foreground">
        No memory context was used for this answer
      </button>
    );
  }

  return (
    <div className="mt-1">
      <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-accent hover:underline">
        {open ? "Hide context" : `Context (${trace.memoriesUsed.length} ${trace.memoriesUsed.length === 1 ? "memory" : "memories"})`}
      </button>
      {open ? (
        <div className="vox-panel-in mt-2 max-w-md rounded-[var(--radius-sm)] border border-border bg-surface p-3">
          {trace.memoriesUsed.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {trace.memoriesUsed.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="text-foreground">{m.content}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {m.similarity > 0 ? <span className="text-muted">{(m.similarity * 100).toFixed(0)}%</span> : null}
                    <ConfidenceBadge confidence={m.confidence} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No memories were retrieved for this answer.</p>
          )}
          {trace.assumptions.length > 0 ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="text-xs font-medium text-muted-foreground">Assumptions</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted">
                {trace.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
