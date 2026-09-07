"use client";

import { useState } from "react";
import Link from "next/link";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Money, Chip, Ago, IdTag, Truthless } from "@/components/observer/primitives";
import type { ObserverState, PendingApproval } from "@/lib/volara/observer";

/**
 * [P4-G] THE HUMAN BOUNDARY, made visible.
 *
 * This panel has one job beyond listing requests: to make it obvious where VOX
 * stops. The banner says it in words, every card repeats the amount and the
 * governor's reasoning, and there is no bulk action, no "approve all", and no
 * auto-approve setting — because none of those exist in the runtime either.
 *
 * WHERE APPROVAL ACTUALLY HAPPENS. The approve control is a LINK to the
 * canonical step-approval surface, not a button that posts from here. That is
 * deliberate: `approveAgentStep()` requires the human to assert the arguments
 * hash it derived server-side, and an Observer that posted an approval on the
 * reader's behalf would be asserting consent the reader never gave to a
 * specific set of arguments. Rejection IS actionable here, because refusing
 * needs no assertion about what is being refused — `rejectCapitalAllocation()`
 * mints nothing and can only ever free capacity.
 */

function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <li key={reason}>
          <Chip tone="var(--warning)">{reason.replace(/_/g, " ")}</Chip>
        </li>
      ))}
    </ul>
  );
}

function ApprovalCard({
  approval,
  onReject,
  rejecting,
}: {
  approval: PendingApproval;
  onReject: (allocationId: string) => void;
  rejecting: boolean;
}) {
  const passed = approval.governorVerdict === "PASS";

  return (
    <li className="instrument rounded-[var(--radius-sm)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="vox-eyebrow">Capital request</p>
          <p className="vox-headline mt-1 text-lg">
            <Money cents={approval.requestedCents} emphasis />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* A PASS is not an approval, and the chip says which it is. */}
          <Chip tone={passed ? "var(--accent-blue)" : "var(--danger)"} title="The governor's verdict, not a decision">
            {passed ? "Governor: well-formed" : `Governor: ${approval.governorVerdict ?? "unknown"}`}
          </Chip>
          {approval.expired ? <Chip tone="var(--danger)">Expired</Chip> : null}
        </div>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-muted">{approval.rationale}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="vox-unit">Requesting agent</dt>
          <dd className="mt-0.5 truncate text-foreground">
            {approval.agent ? `${approval.agent.name} · ${approval.agent.role ?? "—"}` : "Unknown"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="vox-unit">Strategy</dt>
          <dd className="mt-0.5 truncate text-foreground">
            {approval.strategy ? approval.strategy.name : <span className="text-muted-foreground">None</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="vox-unit">Opportunity</dt>
          <dd className="mt-0.5 truncate text-foreground">
            {approval.opportunity ? approval.opportunity.title : <span className="text-muted-foreground">None</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="vox-unit">Requested</dt>
          <dd className="mt-0.5 truncate text-foreground">
            <Ago at={approval.requestedAt} />
          </dd>
        </div>
      </dl>

      {approval.governorReasons.length > 0 ? (
        <div className="mt-3">
          <p className="vox-unit mb-1.5">Constraints recorded at request time</p>
          <ReasonList reasons={approval.governorReasons} />
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <IdTag id={approval.correlationId} label="trace" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onReject(approval.allocationId)}
            disabled={rejecting}
            className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            {rejecting ? "Declining…" : "Decline"}
          </button>
          {approval.approvePath && !approval.expired ? (
            // A LINK, not a POST. See the module note: consent to a specific
            // set of arguments has to be given on the surface that shows them.
            <Link
              href={`/agents?run=${approval.runId}&step=${approval.stepId}`}
              className="rounded-[var(--radius-xs)] border border-[var(--accent)] bg-[var(--accent-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
            >
              Review &amp; approve →
            </Link>
          ) : (
            <span className="vox-unit text-muted-foreground">
              {approval.expired ? "CAN NO LONGER BE APPROVED" : "NOT YET SUBMITTED"}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function ApprovalCenter({ state, onChanged }: { state: ObserverState; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reject(allocationId: string) {
    setRejecting(allocationId);
    setError(null);
    try {
      // The canonical rejection endpoint. No Observer-specific logic.
      const response = await fetch(`/api/volara/capital/${allocationId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Declined from the Global Observer." }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "The request could not be declined.");
        return;
      }
      // Re-read authoritative state rather than mutating a local copy: the
      // server decides what happened, and a locally-patched row would be the
      // client reconstructing runtime truth.
      onChanged();
    } catch {
      setError("The request could not be declined.");
    } finally {
      setRejecting(null);
    }
  }

  const pending = state.pendingApprovals;

  return (
    <InstrumentPanel depth={pending.length > 0 ? "raised" : "panel"} className="overflow-hidden" live={pending.length > 0}>
      <PanelHeader
        eyebrow="Approval centre"
        title={pending.length > 0 ? `${pending.length} awaiting a human` : "Human decisions"}
        description="VOX can reason and request. A human authorizes consequential execution — every allocation, of every size, with no threshold below which it becomes automatic."
      />

      <div className="mx-5 mt-3 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--accent-muted)] px-3.5 py-2.5">
        <p className="text-[11px] leading-relaxed text-muted">
          <span className="vox-unit text-[var(--accent)]">The boundary</span> — an agent may put a request in front of
          you. It cannot approve one, raise its own ceiling, or authorize another agent. Approving happens on the step
          surface, where the exact arguments you are consenting to are shown.
        </p>
      </div>

      <Seam className="mt-4" />

      <div className="p-4">
        {error ? (
          <p className="mb-3 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-muted)] px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        {pending.length === 0 ? (
          <Truthless
            label="NO HUMAN DECISIONS PENDING"
            detail="No agent has an outstanding capital request. This is the resting state — it does not mean anything was approved."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((approval) => (
              <ApprovalCard
                key={approval.allocationId}
                approval={approval}
                onReject={reject}
                rejecting={rejecting === approval.allocationId}
              />
            ))}
          </ul>
        )}
      </div>
    </InstrumentPanel>
  );
}
