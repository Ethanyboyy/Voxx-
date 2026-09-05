"use client";

/**
 * [P4-C2] The surface a person actually approves at.
 *
 * Everything shown here is fetched from the server's own canonical state, not
 * assembled from the run object this component sits next to. That matters: the
 * `AgentStep.input` in the run payload is whatever the list endpoint happened to
 * serialize, while `GET .../approve` returns the arguments re-parsed through the
 * tool's schema and the hash computed from them — the same computation the
 * approval is later checked against. Showing one thing and approving another is
 * the exact failure this phase exists to prevent.
 *
 * The UI IS NOT THE AUTHORIZATION. It submits `argumentsHash` and nothing else;
 * the server re-derives the action, the arguments, the capability and the
 * classification from the persisted step. A caller who skips this component
 * entirely gains nothing — which is the point of putting the check on the
 * server rather than in the button.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export interface PendingStepApproval {
  runId: string;
  stepId: string;
  actionId: string;
  description: string;
  finalizedArguments: unknown;
  argumentsHash: string;
  classificationHash: string;
  policyDecision: string;
  capability: string;
  requiredLevel: string;
  alreadyApproved: boolean;
}

type Phase = "loading" | "ready" | "unavailable";

export function StepApprovalPanel({
  runId,
  stepId,
  onRejected,
}: {
  runId: string;
  stepId: string;
  /** Rejection cancels the run, so the list needs to re-read it. */
  onRejected?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pending, setPending] = useState<PendingStepApproval | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const base = `/api/agents/${runId}/steps/${stepId}`;

  // A GET, and only a GET. Looking at a pending action is not approving it.
  const fetchPending = useCallback(async (): Promise<
    { pending: PendingStepApproval } | { unavailable: string }
  > => {
    const res = await fetch(`${base}/approve`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.pending) return { unavailable: data?.error ?? "This step has nothing to approve." };
    return { pending: data.pending as PendingStepApproval };
  }, [base]);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchPending>>) => {
    if ("unavailable" in result) {
      setPhase("unavailable");
      setMessage(result.unavailable);
      return;
    }
    setPending(result.pending);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPending().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPending, apply]);

  async function approve() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The hash of what is rendered above, and nothing else. No action, no
        // capability, no arguments — the server would ignore them anyway, and
        // sending them would suggest this component decides what is approved.
        body: JSON.stringify({ argumentsHash: pending.argumentsHash }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(data?.error ?? "Could not record the approval.");
        // A HASH_MISMATCH means the action moved under the person deciding.
        // Re-reading is the only correct response: the old view is stale, and
        // re-submitting it would be approving something no longer there.
        if (data?.reason === "HASH_MISMATCH") apply(await fetchPending());
        return;
      }
      setMessage(data?.reused ? "Already approved — the existing approval still stands." : "Approved.");
      apply(await fetchPending());
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/reject`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(data?.error ?? "Could not record the rejection.");
        return;
      }
      setPhase("unavailable");
      setMessage("Rejected. The run was cancelled.");
      onRejected?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
    return <p className="mt-3 text-xs text-muted">Loading the exact action…</p>;
  }
  if (phase === "unavailable" || !pending) {
    return message ? <p className="mt-3 text-xs text-muted">{message}</p> : null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-sm)] border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="vox-eyebrow">Approve this exact action</p>
        <Badge tone={pending.policyDecision === "ALLOW" ? "neutral" : "warning"}>{pending.policyDecision}</Badge>
        {pending.alreadyApproved ? <Badge tone="success">approved</Badge> : null}
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          action: <code>{pending.actionId}</code>
        </span>
        <span>
          capability: <code>{pending.capability}</code> · requires {pending.requiredLevel}
        </span>
      </div>

      {/*
        The FINALIZED arguments — what `tool.execute()` will receive — never the
        authored template. A panel showing "{{step0.output}}" would be asking
        someone to consent to a placeholder.
      */}
      <div>
        <p className="vox-eyebrow mb-1">Arguments</p>
        <pre className="max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-border bg-surface-hover p-2 text-xs text-foreground">
          {JSON.stringify(pending.finalizedArguments, null, 2)}
        </pre>
      </div>

      <p className="break-all text-[11px] text-muted">
        arguments hash: <code>{pending.argumentsHash}</code>
      </p>

      <p className="text-xs text-muted">
        Approving records consent to these exact arguments, once. It does not grant the capability — that is the
        separate permission above — and an approval expires if it is not used.
      </p>

      {message ? <p className="text-xs text-foreground">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={approve} disabled={submitting}>
          Approve these arguments
        </Button>
        <Button size="sm" variant="danger" onClick={reject} disabled={submitting}>
          Reject
        </Button>
      </div>
    </div>
  );
}
