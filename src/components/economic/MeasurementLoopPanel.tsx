"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import type { LoopState, LoopStep } from "@/lib/economic/measurementLoop";

/**
 * [P6-D] THE OPERATOR WORKFLOW THAT CLOSES THE LOOP.
 *
 * The minimum needed to complete a measurement, and nothing else. No charts, no
 * tiles, no second dashboard — this panel exists because the chain
 *
 *   corroborate -> declare -> predict -> OBSERVE -> reconcile
 *
 * has exactly one step a person has to perform by hand, and that step needed a
 * form.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THIS SURFACE MUST NOT LET A PERSON BELIEVE
 * ---------------------------------------------------------------------------
 *
 * THAT VOX OBSERVED IT. The form says, in the form, that the figure is being
 * entered by hand and that VOX did not see it. That sentence sits next to the
 * input rather than in a tooltip, because the whole provenance distinction in
 * P6-B rests on it and a person filling in a number is exactly the moment it
 * matters.
 *
 * THAT ONE RESULT IS A TRACK RECORD. The response's caveats are rendered in
 * full, including the sample-size one. A panel that showed "predicted $500,
 * observed $40" and stopped would be inviting the reader to conclude something
 * about VOX's accuracy from n=1.
 *
 * The prediction is shown BEFORE the input, read-only, and the form cannot
 * change it — the ordering invariant made visible.
 */

const STEP_LABEL: Record<LoopStep, string> = {
  CORROBORATE: "Needs corroboration",
  DECLARE_EXPERIMENT: "Ready for an experiment",
  RECORD_PREDICTION: "Needs a prediction",
  ENTER_OUTCOME: "Waiting on the result",
  COMPLETE: "Loop closed",
};

const STEP_CLASS: Record<LoopStep, string> = {
  CORROBORATE: "text-amber-300/90",
  DECLARE_EXPERIMENT: "text-sky-300/90",
  RECORD_PREDICTION: "text-sky-300/90",
  ENTER_OUTCOME: "text-white/70",
  COMPLETE: "text-emerald-300/90",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface OutcomeResponse {
  promoted?: { figure: string; from: string; to: string };
  settled?: { revenueCents: number; expenseCents: number };
  reconciliation?:
    | { reconciled: true; predictedNetCents: number; observedNetCents: number; errorCents: number }
    | { reconciled: false; reason: string; detail: string };
  calibration?: { totalResolved: number; insufficientSample: boolean; overallFactor: number | null };
  caveats?: string[];
  error?: string;
}

export function MeasurementLoopPanel({ states }: { states: LoopState[] }) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OutcomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const awaiting = states.filter((s) => s.step === "ENTER_OUTCOME");
  const closed = states.filter((s) => s.step === "COMPLETE");

  async function submit(experimentId: string, form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    setResult(null);
    const data = new FormData(form);
    try {
      const response = await fetch(`/api/economic/experiments/${experimentId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observedValue: Number(data.get("observedValue")),
          observedTotal: Number(data.get("observedTotal")),
          unit: String(data.get("unit") ?? "orders"),
          // Dollars in the form, minor units on the wire. Rounded once, here,
          // rather than letting a float reach the ledger.
          amountMinor: Math.round(Number(data.get("amount")) * 100),
          amountScale: 2,
          amountCurrency: "USD",
          spentMinor: Math.round(Number(data.get("spent") ?? 0) * 100),
          provenance: String(data.get("provenance") ?? ""),
          limitations: String(data.get("limitations") ?? "") || undefined,
        }),
      });
      const body: OutcomeResponse = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The measurement was refused.");
        return;
      }
      setResult(body);
      setOpenFor(null);
      router.refresh();
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <InstrumentPanel>
      <PanelHeader
        eyebrow="Measurement"
        title="Close the loop"
        description="An opportunity becomes evidence only once something was predicted and then observed. The prediction is frozen first and cannot be edited afterwards; the result is entered by you, and VOX records that it did not see it."
      />

      {states.length === 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-white/45">
          No opportunities on record. Nothing to measure.
        </p>
      ) : (
        <>
          {/* The whole pipeline, one line each — not a tile per stage. */}
          <dl className="mt-4 space-y-1.5">
            {states.map((state) => (
              <div key={state.opportunityId} className="flex flex-wrap items-baseline gap-x-3 text-[11px]">
                <dt className="text-white/70">{state.title}</dt>
                <dd className={`font-mono uppercase tracking-wide ${STEP_CLASS[state.step]}`}>
                  {STEP_LABEL[state.step]}
                </dd>
                {state.step === "CORROBORATE" && state.blocking.length > 0 && (
                  <dd className="text-white/35">
                    needs: {state.blocking.map((b) => b.label).join(", ")}
                  </dd>
                )}
                {state.experiment?.prediction && (
                  <dd className="font-mono tabular-nums text-white/40">
                    predicted {usd(state.experiment.prediction.predictedNetCents)} net
                    {state.experiment.prediction.observedNetCents !== null &&
                      ` · observed ${usd(state.experiment.prediction.observedNetCents)}`}
                  </dd>
                )}
              </div>
            ))}
          </dl>

          {awaiting.length > 0 && <Seam />}

          {/* The one manual step. */}
          {awaiting.map((state) => {
            const prediction = state.experiment!.prediction!;
            const isOpen = openFor === state.experiment!.experimentId;
            return (
              <div key={state.experiment!.experimentId} className="mt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                  {state.title}
                </h4>

                {/* The prediction, read-only, ABOVE the input. */}
                <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                  VOX predicted{" "}
                  <span className="font-mono tabular-nums text-white/80">{usd(prediction.predictedNetCents)}</span> net
                  over {prediction.horizonDays} day{prediction.horizonDays === 1 ? "" : "s"} at{" "}
                  {Math.round(prediction.predictedProbability * 100)}%, on a{" "}
                  <span className="font-mono uppercase tracking-wide text-white/60">
                    {prediction.predictedBasis.replace("_", " ").toLowerCase()}
                  </span>{" "}
                  basis. Frozen {new Date(prediction.createdAt).toLocaleString()} — it cannot be edited now.
                </p>

                {!isOpen ? (
                  <button
                    type="button"
                    onClick={() => setOpenFor(state.experiment!.experimentId)}
                    className="mt-2 text-[11px] uppercase tracking-wide text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                  >
                    Enter what actually happened
                  </button>
                ) : (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(state.experiment!.experimentId, event.currentTarget);
                    }}
                  >
                    {/* Stated beside the inputs, not in a tooltip. */}
                    <p className="text-[11px] leading-relaxed text-amber-200/70">
                      You are entering this by hand. VOX did not observe it, the measurement is recorded as
                      human-entered, and the ledger rows will say so.
                    </p>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field name="observedValue" label="Units counted" type="number" defaultValue="0" />
                      <Field name="observedTotal" label="Units available" type="number" defaultValue="0" />
                      <Field name="unit" label="Unit" defaultValue="orders" />
                      <Field name="amount" label="Amount (USD)" type="number" step="0.01" defaultValue="0" />
                      <Field name="spent" label="Spent (USD)" type="number" step="0.01" defaultValue="0" />
                    </div>
                    <p className="text-[11px] leading-relaxed text-white/35">
                      Zero is a real answer. An experiment that earned nothing is the most useful result there is for
                      catching an optimistic forecast.
                    </p>

                    <Field name="provenance" label="Where you got this figure" required />
                    <Field name="limitations" label="What it does not establish (optional)" />

                    <div className="flex gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded border border-white/15 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-wide text-white/75 hover:bg-white/10 disabled:opacity-40"
                      >
                        {busy ? "Recording…" : "Record the measurement"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenFor(null)}
                        className="text-[11px] uppercase tracking-wide text-white/35 hover:text-white/60"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}

          {error && (
            <p className="mt-3 rounded border border-rose-500/25 bg-rose-500/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-rose-200/80">
              {error}
            </p>
          )}

          {/* The result, with its caveats rendered in full. */}
          {result?.reconciliation && (
            <div className="mt-3 rounded border border-white/10 bg-white/[0.03] px-2.5 py-2">
              {result.reconciliation.reconciled ? (
                <p className="text-[11px] leading-relaxed text-white/70">
                  Predicted{" "}
                  <span className="font-mono tabular-nums">{usd(result.reconciliation.predictedNetCents)}</span>,
                  observed{" "}
                  <span className="font-mono tabular-nums">{usd(result.reconciliation.observedNetCents)}</span> from the
                  ledger — off by{" "}
                  <span className="font-mono tabular-nums">{usd(result.reconciliation.errorCents)}</span>.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-amber-200/80">
                  The measurement was recorded and the prediction was not scored:{" "}
                  <span className="font-mono">{result.reconciliation.reason}</span>. {result.reconciliation.detail}
                </p>
              )}
              {result.calibration && (
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Calibration now rests on {result.calibration.totalResolved} scored prediction
                  {result.calibration.totalResolved === 1 ? "" : "s"}.{" "}
                  {result.calibration.insufficientSample && (
                    <span className="font-mono uppercase tracking-wide text-white/35">
                      Still no basis for a correction factor.
                    </span>
                  )}
                </p>
              )}
              {result.caveats && result.caveats.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {result.caveats.map((caveat) => (
                    <li key={caveat} className="text-[11px] leading-relaxed text-white/35">
                      — {caveat}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {closed.length > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              {closed.length} loop{closed.length === 1 ? "" : "s"} closed. Each one is a single scored prediction, not a
              demonstration of profitability.
            </p>
          )}
        </>
      )}
    </InstrumentPanel>
  );
}

function Field({
  name,
  label,
  type = "text",
  step,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-white/35">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        min={type === "number" ? 0 : undefined}
        defaultValue={defaultValue}
        required={required}
        className="mt-0.5 w-full rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white/80 outline-none focus:border-white/30"
      />
    </label>
  );
}
