"use client";

import { useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import type { ExperimentEvidence } from "@/lib/economic/evidence";
import type { ProbabilityEvidence } from "@/lib/economic/probability";

/**
 * [P5-D/E/F] The evidence surface.
 *
 * DESIGN CONSTRAINT, not a style choice — the same one `ProfitLossPanel` works
 * under, applied to measurement instead of profit: THIS SURFACE MUST NEVER LET
 * AN ABSENCE READ AS A ZERO, OR A MEASUREMENT READ AS A RESULT.
 *
 * Four states have to stay visually distinct, because three of them are
 * routinely rendered identically by dashboards and the confusion is expensive:
 *
 *   AN EXACT AMOUNT        "1,250.00 USD" — the store was asked and answered
 *   A REAL ZERO            "0.00 USD"     — asked, and the answer was nothing
 *   UNAVAILABLE            named in words — nobody was told anything
 *   NOT A MONETARY RULE    no amount at all — this measured a count
 *
 * The second and third are the pair that matters. A store that made no sales
 * and a store whose token expired are opposite facts, and a panel that shows
 * "0.00" for both is lying about one of them. So an unavailable observation
 * renders its failure name and its explanation, and never a numeral.
 *
 * Every measurement is shown with what its rule does NOT establish, immediately
 * beneath the number. That text is not a disclaimer bolted on by this component
 * — it comes from the frozen rule itself, so a number cannot reach a screen
 * separated from its own limits.
 */

type SerializedEvidence = Omit<
  ExperimentEvidence,
  "lastObservationAttemptAt" | "measurement" | "outcome"
> & {
  lastObservationAttemptAt: string | null;
  measurement:
    | (Omit<NonNullable<ExperimentEvidence["measurement"]>, "observedAt" | "external"> & {
        observedAt: string;
        external:
          | (Omit<
              NonNullable<NonNullable<ExperimentEvidence["measurement"]>["external"]>,
              "retrievedAt" | "windowStart" | "windowEnd"
            > & { retrievedAt: string | null; windowStart: string | null; windowEnd: string | null })
          | null;
      })
    | null;
  outcome:
    | (Omit<NonNullable<ExperimentEvidence["outcome"]>, "recordedAt"> & { recordedAt: string | null })
    | null;
};

const STAGE_LABEL: Record<string, string> = {
  NOT_DISPATCHED: "Not dispatched",
  AWAITING_AUTHORIZATION: "Waiting for your approval",
  EXECUTING: "Executing",
  IN_DOUBT: "In doubt",
  EXECUTION_FAILED: "Execution failed",
  AWAITING_OBSERVATION: "Awaiting observation",
  MEASUREMENT_RECORDED: "Measured — not yet evidence",
  RECONCILED: "Reconciled",
};

/**
 * What each stage means in plain words.
 *
 * `IN_DOUBT` gets the longest note deliberately: it is the state people are
 * most likely to misread as "failed", and the difference matters — a failure is
 * known not to have produced anything, while this one is genuinely unknown.
 */
const STAGE_NOTE: Record<string, string> = {
  NOT_DISPATCHED: "Nothing has run. What will be counted is declared before the experiment runs, not after.",
  AWAITING_AUTHORIZATION: "The executor stopped at the permission boundary and is waiting for a person.",
  EXECUTING: "The run is in progress.",
  IN_DOUBT:
    "A step began and its end was never recorded. It may have run, or half-run — nobody knows. This is not a failure and it is not a success, and it cannot become either.",
  EXECUTION_FAILED: "The run ended without producing anything to observe.",
  AWAITING_OBSERVATION: "The run completed. Nothing has read its output yet.",
  MEASUREMENT_RECORDED:
    "A measurement exists. It is NOT yet evidence — nothing counts it until a person records a verdict.",
  RECONCILED: "A person recorded a verdict against this measurement.",
};

function Stage({ stage }: { stage: string }) {
  const emphatic = stage === "IN_DOUBT" || stage === "EXECUTION_FAILED";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        emphatic
          ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
          : "bg-white/5 text-white/60 ring-1 ring-white/10"
      }`}
    >
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

/**
 * The measured figure.
 *
 * Branches on the MEASUREMENT, never on truthiness of a number — `money` being
 * null and `amountMinor` being 0 are different facts and `if (amount)` would
 * collapse them.
 */
function Figure({ measurement }: { measurement: NonNullable<SerializedEvidence["measurement"]> }) {
  if (measurement.money) {
    return (
      <div>
        <div className="font-mono text-2xl tabular-nums text-white">{measurement.money.formatted}</div>
        <div className="mt-0.5 text-xs text-white/50">
          across {measurement.observedValue} order{measurement.observedValue === 1 ? "" : "s"} · gross
          order value at order time
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-2xl tabular-nums text-white">
        {measurement.observedValue}
        {measurement.observedTotal !== measurement.observedValue && (
          <span className="text-white/40"> / {measurement.observedTotal}</span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-white/50">{measurement.unit}</div>
    </div>
  );
}

/**
 * The absence.
 *
 * Deliberately carries NO numeral of any kind. The whole point of this block is
 * that a reader skimming the panel cannot mistake it for a small result.
 */
function Unavailable({ failure, detail }: { failure: string; detail: string | null }) {
  return (
    <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">
        Observation unavailable — {failure}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-white/60">
        {detail ?? "No figure was obtained."} This is not a value of zero.
      </p>
    </div>
  );
}

function Row({ evidence }: { evidence: SerializedEvidence }) {
  const [open, setOpen] = useState(false);
  const m = evidence.measurement;

  return (
    <div className="border-t border-white/5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/80">{evidence.hypothesis}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Stage stage={evidence.stage} />
            {evidence.observationRule && (
              <span className="font-mono text-[11px] text-white/35">{evidence.observationRule}</span>
            )}
          </div>
        </div>
        {m && <Figure measurement={m} />}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-white/45">{STAGE_NOTE[evidence.stage] ?? ""}</p>

      {/* The absence, when there is one and no measurement was written. */}
      {!m && evidence.lastObservationFailure && (
        <div className="mt-3">
          <Unavailable failure={evidence.lastObservationFailure} detail={null} />
        </div>
      )}

      {/* What this number does NOT establish — from the frozen rule itself, so
          it can never be separated from the figure it qualifies. */}
      {m && evidence.ruleDoesNotEstablish && (
        <p className="mt-2 border-l-2 border-white/10 pl-3 text-xs leading-relaxed text-white/50">
          {evidence.ruleDoesNotEstablish}
        </p>
      )}

      {m && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[11px] uppercase tracking-wide text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
          >
            {open ? "Hide provenance" : "Where did this come from?"}
          </button>
          {open && (
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
              <Detail label="Source" value={m.source} />
              <Detail label="Provenance" value={m.provenance} />
              {m.external && <Detail label="Store" value={m.external.scope} />}
              {m.external?.windowStart && (
                <Detail
                  label="Window"
                  value={`${m.external.windowStart} → ${m.external.windowEnd} (end exclusive)`}
                />
              )}
              {m.external?.retrievedAt && <Detail label="Retrieved" value={m.external.retrievedAt} />}
              {m.external?.responseDigest && (
                <Detail label="Response digest" value={m.external.responseDigest.slice(0, 16) + "…"} />
              )}
              <Detail label="Run" value={m.agentRunId ?? "—"} />
              <Detail label="Step" value={m.agentStepId ?? "—"} />
              {m.money && <Detail label="Currency" value={`${m.money.currency} (scale ${m.money.amountScale})`} />}
            </dl>
          )}
        </>
      )}

      {evidence.outcome && (
        <p className="mt-2 text-xs text-white/55">
          Verdict: <span className="text-white/80">{evidence.outcome.verdict}</span> · basis{" "}
          <span className="font-mono text-white/60">{evidence.outcome.basis}</span>
        </p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 uppercase tracking-wide text-white/35">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-white/60">{value}</dd>
    </div>
  );
}

/**
 * The measured probability.
 *
 * Renders "NO BASIS" rather than a percentage when nothing has been decided —
 * the same posture the Global Observer takes with `<Ratio>`. A system with no
 * trials has no success rate, and 0% and 50% are both claims about the world
 * that nothing supports.
 */
function Probability({ evidence }: { evidence: ProbabilityEvidence }) {
  if (evidence.probability === null) {
    return (
      <div>
        <div className="font-mono text-xl uppercase tracking-wide text-white/35">No basis</div>
        <p className="mt-1 text-xs text-white/45">
          No experiment has been reconciled yet. A success rate over zero decided trials is not a small
          number — it does not exist.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-xl tabular-nums text-white">
        {evidence.wins} / {evidence.decided}
      </div>
      <p className="mt-1 text-xs text-white/45">
        {evidence.wins} win{evidence.wins === 1 ? "" : "s"} out of {evidence.decided} decided
        experiment{evidence.decided === 1 ? "" : "s"}
        {evidence.inconclusive > 0 && `, with ${evidence.inconclusive} inconclusive (counted in neither)`}.
        Shown as a fraction rather than a percentage so a single trial cannot read as 100%.
      </p>
    </div>
  );
}

export function EvidencePanel({
  evidence,
  probability,
  integrityIssues,
}: {
  evidence: SerializedEvidence[];
  probability: ProbabilityEvidence;
  integrityIssues: number;
}) {
  return (
    <InstrumentPanel>
      <PanelHeader
        eyebrow="Measurement"
        title="Experiment evidence"
        description="What VOX actually observed, how it observed it, and what that does not establish. A measurement here is not a result until a person records a verdict against it."
      />

      <div className="mt-4">
        <Probability evidence={probability} />
      </div>

      {integrityIssues > 0 && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/[0.07] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-300">
            {integrityIssues} integrity {integrityIssues === 1 ? "issue" : "issues"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/60">
            A measurement no longer matches its own digest, or a verdict rests on evidence that has
            changed since. The figures above may be standing on something that moved.
          </p>
        </div>
      )}

      <Seam />

      <div className="mt-2">
        {evidence.length === 0 ? (
          <p className="py-6 text-sm text-white/40">
            No experiments yet. An experiment declares what will be counted before it runs.
          </p>
        ) : (
          evidence.map((e) => <Row key={e.experimentId} evidence={e} />)
        )}
      </div>
    </InstrumentPanel>
  );
}
