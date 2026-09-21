"use client";

import { useState } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import type { CommercialActionView } from "@/lib/commerce/execute";

/**
 * [P5-G] The commercial action surface.
 *
 * DESIGN CONSTRAINT, not a style choice — and it is a different one from the
 * evidence panel's. There, an absence must not read as a zero. Here, AN UNKNOWN
 * OUTCOME MUST NOT READ AS EITHER A SUCCESS OR A FAILURE.
 *
 * That is harder than it sounds, because a dashboard's whole grammar pushes
 * toward two colours. A green tick and a red cross are the two shapes a person
 * is looking for, and an ambiguous outcome rendered in either one is a lie:
 * green claims a discount exists in a merchant's store when nobody knows, and
 * red claims nothing happened when something may have. So SUBMITTED and UNKNOWN
 * get their own treatment, their own words, and an explicit instruction — ask
 * the store — rather than being sorted into the nearest terminal state.
 *
 * The second rule: A SUCCESSFUL WRITE IS NOT AN ECONOMIC RESULT. A created
 * discount code is a thing that exists, not money earned. Nothing on this panel
 * shows an amount, a currency, or a total, and redemptions are labelled as a
 * count of uses precisely so nobody reads them as revenue.
 */

type SerializedAction = Omit<
  CommercialActionView,
  "parameters" | "submittedAt" | "verifiedAt"
> & {
  parameters:
    | (Omit<NonNullable<CommercialActionView["parameters"]>, "startsAt" | "endsAt"> & {
        startsAt: string;
        endsAt: string;
      })
    | null;
  submittedAt: string | null;
  verifiedAt: string | null;
};

/**
 * Five states, three visual treatments.
 *
 * SUBMITTED and UNKNOWN share the amber treatment because they are the same
 * epistemic situation — something may have happened — and differ only in how
 * VOX came to be unsure. FAILED is deliberately NOT amber: "the store declined
 * and nothing exists" is a clean, known, safe outcome and should not carry the
 * visual weight of an unresolved one.
 */
const STATUS: Record<string, { label: string; tone: "neutral" | "good" | "unknown"; note: string }> = {
  PLANNED: {
    label: "Declared",
    tone: "neutral",
    note: "Frozen and waiting. Nothing has been sent to the store. Performing it needs an ACT-level write permission and a separate approval of these exact parameters.",
  },
  SUBMITTED: {
    label: "Outcome unknown",
    tone: "unknown",
    note: "Handed to the store, and what happened was never recorded. It may have been created. It will NOT be retried — ask the store instead.",
  },
  UNKNOWN: {
    label: "Outcome unknown",
    tone: "unknown",
    note: "The request was submitted and VOX cannot tell what happened. This is not a failure and it is not a success. Ask the store.",
  },
  SUCCEEDED: {
    label: "Code created",
    tone: "good",
    note: "The store confirmed it, and every authorized parameter matched. A discount code now exists. No money moved and nothing has been sold.",
  },
  FAILED: {
    label: "Declined",
    tone: "neutral",
    note: "The store explicitly declined. Nothing was created.",
  },
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS[status] ?? { label: status, tone: "neutral" as const, note: "" };
  const tone =
    meta.tone === "unknown"
      ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      : meta.tone === "good"
        ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
        : "bg-white/5 text-white/60 ring-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ${tone}`}
    >
      {meta.label}
    </span>
  );
}

function Row({ action }: { action: SerializedAction }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const meta = STATUS[action.status];

  async function askTheStore() {
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch(`/api/commerce/actions/${action.id}/observe`, { method: "POST" });
      const body = (await res.json()) as {
        observed?: boolean;
        exists?: boolean;
        matches?: boolean;
        redemptions?: number | null;
        detail?: string;
        note?: string;
      };
      if (!body.observed) {
        // Never rendered as "absent". A failed check establishes nothing.
        setAnswer(body.note ?? "The store could not be asked. This does not mean the discount is absent.");
      } else if (!body.exists) {
        setAnswer("The store does not hold this code. The write did not land.");
      } else if (!body.matches) {
        setAnswer(
          `The store holds this code but it does NOT match what was authorized — ${body.detail ?? "see the action"}. Someone needs to look at it.`
        );
      } else {
        const uses = body.redemptions ?? null;
        setAnswer(
          `The store holds exactly the authorized code${uses === null ? "" : `, used ${uses} time${uses === 1 ? "" : "s"}`}. Uses are a count, not revenue.`
        );
      }
    } catch {
      setAnswer("The store could not be asked. This does not mean the discount is absent.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="border-t border-white/5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/80">{action.description ?? action.kind}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusChip status={action.status} />
            <span className="font-mono text-[11px] text-white/35">{action.externalScope}</span>
          </div>
        </div>
      </div>

      {meta && <p className="mt-2 text-xs leading-relaxed text-white/45">{meta.note}</p>}

      {/* The unresolved case gets the one action that can resolve it — and the
          button says what it does rather than "retry", because retrying is
          exactly what must not happen here. */}
      {action.outcomeUnresolved && (
        <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-3">
          <p className="text-xs leading-relaxed text-white/70">
            {action.failureDetail ?? "The outcome of this action was never established."}
          </p>
          <button
            type="button"
            onClick={askTheStore}
            disabled={asking}
            className="mt-2 rounded border border-amber-500/30 px-2 py-1 text-[11px] uppercase tracking-wide text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {asking ? "Asking the store…" : "Ask the store what happened"}
          </button>
          {answer && <p className="mt-2 text-xs leading-relaxed text-white/60">{answer}</p>}
        </div>
      )}

      {action.status === "SUCCEEDED" && (
        <p className="mt-2 border-l-2 border-white/10 pl-3 text-xs leading-relaxed text-white/50">
          A discount code existing is not revenue, not profit, and not evidence that the experiment worked. Whether
          any order was caused by it is a separate question that this does not answer.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-[11px] uppercase tracking-wide text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
      >
        {open ? "Hide provenance" : "What exactly was authorized?"}
      </button>
      {open && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
          {action.parameters && (
            <>
              <Detail label="Code" value={action.parameters.code} />
              <Detail
                label="Discount"
                value={`${(action.parameters.percentageFraction * 100).toFixed(2).replace(/\.?0+$/, "")}%`}
              />
              <Detail label="Usage limit" value={String(action.parameters.usageLimit)} />
              <Detail label="Live" value={`${action.parameters.startsAt} → ${action.parameters.endsAt}`} />
            </>
          )}
          <Detail label="Contract digest" value={`${action.contractDigest.slice(0, 16)}…`} />
          <Detail label="Submitted" value={action.submittedAt ?? "—"} />
          <Detail label="Store id" value={action.externalId ?? "—"} />
          <Detail label="Run" value={action.executionRunId ?? "—"} />
          <Detail label="Step" value={action.executionStepId ?? "—"} />
          <Detail
            label="Store checked"
            value={
              action.verifiedAt === null
                ? "never asked"
                : `${action.verifiedAt} — ${action.verifiedExists ? "exists" : "absent"}${action.verifiedExists && action.verifiedMatches === false ? ", MISMATCHED" : ""}`
            }
          />
        </dl>
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

export function CommercialActionPanel({ actions }: { actions: SerializedAction[] }) {
  const unresolved = actions.filter((a) => a.outcomeUnresolved).length;

  return (
    <InstrumentPanel>
      <PanelHeader
        eyebrow="Intervention"
        title="Commercial actions"
        description="The one thing VOX can change in a connected store: create a bounded, reversible discount code, for an action declared and approved in advance. Creating one is not revenue, and it does not establish that anything it may have caused was caused by it."
      />

      {unresolved > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/[0.07] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            {unresolved} {unresolved === 1 ? "action" : "actions"} with an unknown outcome
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/60">
            Something may exist in the store. VOX will not retry these — retrying a write whose outcome is unknown is
            how one authorized action becomes two real ones. Ask the store instead.
          </p>
        </div>
      )}

      <Seam />

      <div className="mt-2">
        {actions.length === 0 ? (
          <p className="py-6 text-sm text-white/40">
            No commercial actions. An action declares exactly what it would do, and is frozen before it is approved.
          </p>
        ) : (
          actions.map((a) => <Row key={a.id} action={a} />)
        )}
      </div>
    </InstrumentPanel>
  );
}
