"use client";

import { useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import type { EconomicPosture } from "@/lib/economic/nextAction";

/**
 * [P6-A] WHY VOX IS DOING WHAT IT IS DOING.
 *
 * ONE panel, not a wall of tiles. The existing Brain-first direction holds: the
 * user asked to see current profit, active opportunities, capital deployed, best
 * and worst opportunity, pending approvals and the reasoning — and the wrong way
 * to deliver that is fourteen boxed metrics, because a grid of numbers answers
 * "what are the figures" while hiding "what should I do". So the panel leads
 * with the DECISION and its reasoning, and the figures sit underneath as the
 * evidence for it.
 *
 * DESIGN CONSTRAINT, carried over from `ProfitLossPanel` and `EvidencePanel`:
 * nothing here may read as money earned. Every figure on this surface is an
 * ESTIMATE about the future, and estimates are rendered with their basis
 * attached and in a visibly different register from the realized P&L above —
 * never in the same row, never in the same type scale as a ledger figure.
 *
 * And a third rule specific to this panel: THE REFUSALS ARE THE CONTENT. An
 * opportunity that cannot be ranked, and the dimension that is missing, is more
 * actionable than a rank would have been. A surface that showed only the
 * recommendation would be one nobody could argue with.
 */

type SerializedPosture = EconomicPosture;

function usdFromCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const KIND_LABEL: Record<string, string> = {
  OBSERVE_EXPERIMENT: "Observe a finished experiment",
  RECONCILE_EXPERIMENT: "Your verdict is needed",
  SCORE_PREDICTION: "Score a prediction",
  DECIDE_EXPERIMENT: "Decide on an experiment",
  REQUEST_CAPITAL: "Fund the best opportunity",
  CORROBORATE_OPPORTUNITY: "Corroborate before funding",
  RESEARCH_OPPORTUNITY: "Research what is unknown",
  HOLD: "Hold",
};

/** Actions needing a person are marked as such — VOX cannot do these itself. */
const NEEDS_HUMAN = new Set(["RECONCILE_EXPERIMENT", "REQUEST_CAPITAL"]);

export function PosturePanel({ posture }: { posture: SerializedPosture }) {
  const [showPlan, setShowPlan] = useState(false);
  const { recommendation: rec, plan, calibration, counts, position } = posture;

  return (
    <InstrumentPanel>
      <PanelHeader
        eyebrow="Decision"
        title="What to do next"
        description="Ranked by expected net profit per day, over opportunities whose figures have an established basis. Every number below is an estimate about the future, not money earned."
      />

      {/* THE DECISION, first. Not a metric grid. */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/60 ring-1 ring-white/10">
            {KIND_LABEL[rec.kind] ?? rec.kind}
          </span>
          {NEEDS_HUMAN.has(rec.kind) && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/30">
              Needs you
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-white/85">{rec.action}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/50">{rec.reason}</p>
        {rec.path !== "none" && (
          <p className="mt-1.5 font-mono text-[11px] text-white/35">via {rec.path}</p>
        )}
        {rec.expectedNetPerDayCents !== null && (
          <p className="mt-2 text-xs text-white/55">
            Expected{" "}
            <span className="font-mono tabular-nums text-white/80">
              {usdFromCents(rec.expectedNetPerDayCents)}/day
            </span>
            {rec.opportunityCostPerDayCents !== null && rec.opportunityCostPerDayCents > 0 && (
              <>
                {" "}· giving up {usdFromCents(rec.opportunityCostPerDayCents)}/day by not taking the next best
              </>
            )}
            . An estimate.
          </p>
        )}
      </div>

      <Seam />

      {/* The position, in one line rather than four tiles. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
        <Figure label="Spend ceiling" value={usdFromCents(position.ceilingCents)} />
        <Figure label="Committed" value={usdFromCents(position.spentCents)} />
        <Figure label="Allocatable" value={usdFromCents(plan.limits.allocatableCents)} />
        <Figure label="Held in reserve" value={usdFromCents(plan.limits.reservedCents)} />
        <Figure
          label="Concurrency"
          value={`${counts.activeExperiments} running, ${plan.limits.concurrencySlots} free`}
        />
        {position.halted && <Figure label="Status" value="HALTED" emphatic />}
      </dl>

      {/* Calibration — how much VOX's own forecasts are worth. */}
      <p className="mt-3 text-xs leading-relaxed text-white/45">
        {calibration.insufficientSample ? (
          <>
            <span className="font-mono uppercase tracking-wide text-white/35">No basis</span> for trusting these
            estimates yet — {calibration.totalResolved} prediction
            {calibration.totalResolved === 1 ? "" : "s"} resolved against the ledger, below the minimum needed to
            derive a correction. The figures above are unadjusted.
          </>
        ) : (
          <>
            Across {calibration.totalResolved} resolved predictions, outcomes have come in at{" "}
            <span className="font-mono tabular-nums text-white/70">
              {(calibration.overallFactor! * 100).toFixed(0)}%
            </span>{" "}
            of what VOX predicted
            {calibration.overallFactor! < 0.9 ? " — its forecasts run optimistic." : "."}
          </>
        )}
      </p>

      <button
        type="button"
        onClick={() => setShowPlan((v) => !v)}
        className="mt-3 text-[11px] uppercase tracking-wide text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
      >
        {showPlan ? "Hide the full plan" : `Why these and not the other ${counts.opportunitiesConsidered - plan.selected.length}?`}
      </button>

      {showPlan && (
        <div className="mt-3 space-y-4">
          {plan.selected.length > 0 && (
            <Group title={`Selected (${plan.selected.length})`}>
              {plan.selected.map((s) => (
                <Line
                  key={s.expectation.opportunityId}
                  id={s.expectation.opportunityId}
                  right={`${usdFromCents(s.expectation.expectedNetPerDayCents)}/day`}
                  detail={`${s.expectation.summary} ${s.rationale}`}
                />
              ))}
            </Group>
          )}

          {/* The deferrals, each with the binding reason. */}
          {plan.deferred.length > 0 && (
            <Group title={`Not selected (${plan.deferred.length})`}>
              {plan.deferred.map((d) => (
                <Line
                  key={d.opportunityId}
                  id={d.opportunityId}
                  right={d.reason.replace(/_/g, " ").toLowerCase()}
                  detail={d.detail}
                />
              ))}
            </Group>
          )}

          {/* Unrankable: not worse, unknown. Stated that way. */}
          {plan.unrankable.length > 0 && (
            <Group title={`Cannot be ranked yet (${plan.unrankable.length})`}>
              <p className="pb-1 text-[11px] leading-relaxed text-white/45">
                These are not low-value. Nobody knows what they are worth, and some of them will outrank everything
                above once somebody looks.
              </p>
              {plan.unrankable.map((u) => (
                <Line
                  key={u.opportunityId}
                  id={u.opportunityId}
                  right={`${u.missing.length} unknown`}
                  detail={`Needs: ${u.missing.join(", ")}.`}
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </InstrumentPanel>
  );
}

function Figure({ label, value, emphatic }: { label: string; value: string; emphatic?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="uppercase tracking-wide text-white/35">{label}</dt>
      <dd className={`font-mono tabular-nums ${emphatic ? "text-amber-300" : "text-white/70"}`}>{value}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{title}</h4>
      <div className="mt-1 divide-y divide-white/5">{children}</div>
    </div>
  );
}

function Line({ id, right, detail }: { id: string; right: string; detail: string }) {
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-white/50">{id.slice(0, 12)}…</span>
        <span className="font-mono text-[11px] tabular-nums text-white/60">{right}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">{detail}</p>
    </div>
  );
}
