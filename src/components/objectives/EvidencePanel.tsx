"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { Seam } from "@/components/ui/Instrument";
import { cn } from "@/lib/utils/cn";

/**
 * The objective's evidence dossier — what VOX knows *because* this objective
 * is being pursued, as opposed to what it happens to have recorded recently.
 *
 * This is the user-facing half of the linkage the research and Lab pipelines
 * write at completion time, and it deliberately reads the same graph edges a
 * planning pass reads. If this panel is empty, the planner is working from
 * the same emptiness — which is the point: the user can see exactly what
 * VOX is reasoning from.
 *
 * The grade of each item is never flattened. A retrieved research claim, a
 * recorded experiment and a simulated model output are visually distinct and
 * carry their own stored confidence, because being attached to an objective
 * says where evidence came from and nothing about how good it is.
 */

type EvidenceKind = "research" | "experiment" | "simulation";

interface EvidenceItem {
  memoryId: string;
  kind: EvidenceKind;
  confidence: string;
  content: string;
  recordedAt: string;
  simulated: boolean;
}

interface EvidencePayload {
  items: EvidenceItem[];
  counts: Record<EvidenceKind, number>;
  sourceCounts: { research: number; experiments: number; simulations: number };
}

const KIND_LABEL: Record<EvidenceKind, string> = {
  research: "research",
  experiment: "lab experiment",
  simulation: "lab simulation",
};

/** Simulation gets the warning register — it is the one grade that looks
 *  authoritative (precise numbers) while being the weakest evidence held. */
const KIND_CLASS: Record<EvidenceKind, string> = {
  research: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  experiment: "text-success border-success/40 bg-success/10",
  simulation: "text-warning border-warning/40 bg-warning/10",
};

export function EvidencePanel({ objectiveId }: { objectiveId: string }) {
  const [data, setData] = useState<EvidencePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/objectives/${objectiveId}/evidence`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { evidence: EvidencePayload };
      setData(json.evidence);
      setState("ready");
    } catch {
      // An unreachable dossier is reported as unknown, never as "no evidence" —
      // those mean very different things to someone deciding what to do next.
      setState("error");
    }
  }, [objectiveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sources = data?.sourceCounts;
  const totalSources = sources ? sources.research + sources.experiments + sources.simulations : 0;
  // The graph write is best-effort, so linked items can lag the real work.
  // Saying so is more honest than silently showing the smaller number.
  const unlinked = data ? Math.max(0, totalSources - data.items.length) : 0;

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="vox-eyebrow">Evidence gathered for this objective</p>
        {state === "ready" && data ? (
          <span className="vox-readout text-[11px] text-muted-foreground">
            {data.items.length} linked
            {unlinked > 0 ? ` · ${unlinked} not yet linked` : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        Produced by work run in pursuit of this objective — the same records VOX reads when it plans. Not
        general history, and never an established fact merely for being here.
      </p>
      <Seam className="mt-3" />

      {state === "loading" ? (
        <p className="vox-readout mt-3 text-xs text-muted-foreground">Reading the evidence graph…</p>
      ) : null}

      {state === "error" ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-xs text-danger">Could not read this objective&apos;s evidence.</p>
          <button type="button" onClick={() => void load()} className="vox-press vox-unit hover:text-foreground">
            Retry
          </button>
        </div>
      ) : null}

      {state === "ready" && data ? (
        data.items.length === 0 ? (
          <p className="mt-3 text-xs text-muted">
            {totalSources > 0
              ? `${totalSources} piece(s) of work ran for this objective but none is linked into the graph yet.`
              : "Nothing yet. Research or a Lab result run for this objective will appear here, and in the next plan VOX makes."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.items.map((item) => {
              const open = expanded === item.memoryId;
              return (
                <li key={item.memoryId} className="instrument-well px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "lab-mono inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        KIND_CLASS[item.kind]
                      )}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <ConfidenceBadge confidence={item.confidence} />
                    {item.simulated ? (
                      <Badge tone="warning" title="A model output — not a physical measurement">
                        simulated
                      </Badge>
                    ) : null}
                    <span className="vox-readout ml-auto text-[10px] text-muted-foreground">
                      {new Date(item.recordedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className={cn("mt-1.5 text-xs leading-relaxed text-muted", open ? "" : "line-clamp-3")}>
                    {item.content}
                  </p>
                  {item.content.length > 220 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : item.memoryId)}
                      className="vox-press vox-unit mt-1.5 hover:text-foreground"
                    >
                      {open ? "Show less" : "Show full record"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
