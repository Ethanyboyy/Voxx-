import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { FIGURE_SPECS } from "@/lib/economic/figures";
import type { OpportunityCorroboration } from "@/lib/discovery/corroboration";

/**
 * [P6-C] WHAT VOX PROPOSED, AND WHAT IT WOULD TAKE TO BELIEVE IT.
 *
 * ONE panel, read-only, no decisions of its own. It reports over
 * `listDiscoveryRuns()` and `corroborationPlan()`, both of which read the same
 * `capitalBasisGate()` the portfolio does — so the UI cannot disagree with the
 * engine about whether something is fundable, because it is not computing that
 * question at all.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS SURFACE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 *
 * A MODEL'S HYPOTHESIS MUST NEVER READ AS A FINDING. Everything a discovery
 * pass produces is a number a model made up, and the whole safety argument of
 * P6-B collapses if the surface shows it as "$500 expected profit" in the same
 * register it would show a measured one. So:
 *
 *   every discovered figure is labelled "model hypothesis", in amber, beside
 *     the number — never "estimate", never a confidence percentage;
 *   `DISCOVERY_BASIS_LABEL` is EXPORTED so a test can assert on the labels as
 *     data rather than grepping prose: no basis below MEASURED may be described
 *     with a word that implies it was checked, and a test fails the build if one
 *     is;
 *   a refusal is rendered as the specific reason, because "no candidates" and
 *     "the provider cannot answer" look identical as an empty list and are
 *     completely different facts;
 *   the blocking figures are NAMED, so the next action is a task rather than a
 *     vague instruction to improve confidence.
 */

export const DISCOVERY_BASIS_LABEL: Record<string, { text: string; className: string }> = {
  MODEL_SUGGESTED: { text: "model hypothesis", className: "text-amber-300/90" },
  STATED: { text: "stated by a person", className: "text-white/70" },
  COMPARABLE: { text: "from a comparable VOX ran", className: "text-sky-300/90" },
  MEASURED: { text: "observed in a system of record", className: "text-emerald-300/90" },
  NONE: { text: "not established", className: "text-rose-300/90" },
};

const REFUSAL_TEXT: Record<string, string> = {
  PROVIDER_NOT_STRUCTURED:
    "The configured AI provider cannot return structured proposals, so this pass produced nothing. No candidates were invented to fill the list.",
  UNPARSEABLE_OUTPUT: "The model's answer was not a list of candidates. Nothing was recorded.",
  ALL_CANDIDATES_INVALID:
    "Candidates were proposed and every one was rejected. The reasons are on each candidate below.",
  NO_OBJECTIVE: "There was no objective for the pass to serve. Discovery works towards a goal you set.",
};

export interface DiscoveryRunView {
  id: string;
  brief: string;
  focus: string | null;
  provider: string;
  model: string;
  status: string;
  refusalReason: string | null;
  refusalDetail: string | null;
  proposedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  startedAt: string;
  candidates: {
    id: string;
    title: string;
    thesis: string;
    category: string | null;
    uncertainty: string | null;
    status: string;
    rejectionReason: string | null;
    opportunityId: string | null;
  }[];
}

export function DiscoveryPanel({
  runs,
  corroboration,
}: {
  runs: DiscoveryRunView[];
  corroboration: OpportunityCorroboration[];
}) {
  const blocked = corroboration.filter((c) => !c.capitalEligible);

  return (
    <InstrumentPanel>
      <PanelHeader
        eyebrow="Discovery"
        title="Candidates VOX proposed"
        description="Every number on this surface is a hypothesis a model produced. None of it has been corroborated, and none of it can commit capital until each figure is established on its own evidence."
      />

      {runs.length === 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-white/45">
          No discovery pass has been run. VOX does not propose opportunities on its own schedule — a pass is something
          you or a supervised agent run start, and it needs the{" "}
          <span className="font-mono text-white/60">economic.discover</span> capability granted first.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {runs.map((run) => (
            <div key={run.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-white/70">{run.brief}</span>
                <span className="font-mono text-[11px] text-white/35">
                  {run.provider}/{run.model}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-white/30">
                {new Date(run.startedAt).toLocaleString()} · {run.proposedCount} proposed · {run.acceptedCount} recorded
                · {run.rejectedCount} rejected
                {run.focus ? ` · focus: ${run.focus}` : ""}
              </p>

              {/* A refusal is the content, not an empty state. */}
              {run.refusalReason && (
                <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/80">
                  <span className="font-mono uppercase tracking-wide">{run.refusalReason}</span> —{" "}
                  {REFUSAL_TEXT[run.refusalReason] ?? run.refusalDetail ?? "The pass produced nothing."}
                </p>
              )}

              {run.candidates.length > 0 && (
                <ul className="mt-2 divide-y divide-white/5">
                  {run.candidates.map((candidate) => (
                    <li key={candidate.id} className="py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-xs text-white/75">{candidate.title}</span>
                        <span
                          className={`font-mono text-[11px] uppercase tracking-wide ${
                            candidate.status === "ACCEPTED" ? "text-white/45" : "text-white/30"
                          }`}
                        >
                          {candidate.status === "ACCEPTED" ? "recorded as hypothesis" : "rejected"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">{candidate.thesis}</p>
                      {candidate.uncertainty && (
                        <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                          <span className="uppercase tracking-wide text-white/25">Does not know: </span>
                          {candidate.uncertainty}
                        </p>
                      )}
                      {candidate.rejectionReason && (
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-amber-200/60">
                          {candidate.rejectionReason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <Seam />

      {/* The actionable half: which specific claim blocks each opportunity. */}
      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        What would make these fundable ({blocked.length})
      </h4>
      {blocked.length === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-white/45">
          Nothing is waiting on corroboration.
        </p>
      ) : (
        <div className="mt-1 divide-y divide-white/5">
          {blocked.map((item) => (
            <div key={item.opportunityId} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-white/70">{item.title}</span>
                {item.discovered && (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-amber-300/70">discovered</span>
                )}
              </div>
              <ul className="mt-1 space-y-1">
                {item.blocking.map((block) => {
                  const label = DISCOVERY_BASIS_LABEL[block.basis] ?? DISCOVERY_BASIS_LABEL.NONE;
                  return (
                    <li key={block.figure} className="text-[11px] leading-relaxed">
                      <span className="text-white/45">{FIGURE_SPECS[block.figure]?.label ?? block.figure}</span>{" "}
                      <span className={`font-mono uppercase tracking-wide ${label.className}`}>{label.text}</span>
                      <p className="text-white/35">{block.whatWouldClearIt}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </InstrumentPanel>
  );
}
