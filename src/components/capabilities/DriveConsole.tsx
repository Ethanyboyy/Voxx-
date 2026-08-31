"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea, Label } from "@/components/ui/Field";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Badge } from "@/components/ui/Badge";
import { RunWorkspace } from "@/components/capabilities/RunWorkspace";

/**
 * Ask VOX for something and watch it decide how to do it.
 *
 * The difference between this and the objective form below it: that one goes
 * straight to the planner, which can only reach for tools. This goes through
 * the capability router first, which also decides whether to generate an
 * image, film something, review a result — or to use nothing at all and just
 * answer. That last outcome is a first-class result here, not a failure, which
 * is why the plan is shown even when it is empty.
 *
 * The routing decision is surfaced deliberately. A system that silently picks
 * an expensive provider is one you cannot supervise; showing "why this
 * capability" in one line each is what makes the choice reviewable without
 * exposing the model's reasoning, which is never persisted or returned.
 */

interface PlanStep {
  capability: string;
  reason: string;
  optional: boolean;
}

interface DriveResponse {
  traceId: string;
  runId: string | null;
  plan: {
    strategy: string;
    degraded: boolean;
    notes: string[];
    steps: PlanStep[];
  };
}

export function DriveConsole() {
  const [request, setRequest] = useState("");
  const [result, setResult] = useState<DriveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!request.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    // The previous result is cleared before the new one arrives so a stale
    // trace is never shown next to a new request.
    setResult(null);

    try {
      const response = await fetch("/api/capabilities/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not run that request.");
        return;
      }
      setResult(body as DriveResponse);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <InstrumentPanel className="overflow-hidden">
        <PanelHeader
          eyebrow="Ask"
          title="Give VOX a request"
          description="VOX decides which of its capabilities the request actually needs — including deciding it needs none and should simply answer."
        />
        <Seam className="mt-4" />
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="drive-request">What do you want?</Label>
            <Textarea
              id="drive-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="e.g. Make three variations of the mask, pick the best, then build it into the Suit Bay."
              className="mt-1.5"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Anything consequential still stops for the permission it needs.
            </p>
            <Button type="submit" disabled={submitting || !request.trim()}>
              {submitting ? "Routing…" : "Run"}
            </Button>
          </div>
        </form>
      </InstrumentPanel>

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {result ? (
        <InstrumentPanel className="overflow-hidden">
          <PanelHeader
            eyebrow="Decision"
            title={result.plan.steps.length > 0 ? "How VOX chose to do this" : "No capability needed"}
            description={
              result.plan.steps.length > 0
                ? undefined
                : "VOX judged this answerable from what it already knows, so nothing was generated and nothing was spent."
            }
            actions={result.plan.degraded ? <Badge tone="warning">degraded</Badge> : null}
          />
          {result.plan.steps.length > 0 ? (
            <>
              <Seam className="mt-4" />
              <ul className="px-5 py-3">
                {result.plan.steps.map((step) => (
                  <li key={step.capability} className="flex items-baseline gap-2.5 py-1">
                    <span className="vox-readout shrink-0 text-xs text-accent">{step.capability}</span>
                    <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">{step.reason}</span>
                    {step.optional ? <span className="vox-unit shrink-0">optional</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {result.plan.notes.length > 0 ? (
            <>
              <Seam />
              <ul className="px-5 py-3">
                {result.plan.notes.map((note) => (
                  // Notes are how a degraded plan explains itself — usually a
                  // provider that is not configured. Shown, never hidden.
                  <li key={note} className="py-0.5 text-xs leading-relaxed text-warning">
                    {note}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </InstrumentPanel>
      ) : null}

      {/* The same workspace component the dedicated page mounts — one surface
          for a run's state, not a second summary of it that can disagree. */}
      {result?.runId ? (
        <>
          <RunWorkspace runId={result.runId} />
          <p className="text-xs text-muted">
            <a href={`/workspace/${result.runId}`} className="underline underline-offset-2 hover:text-foreground">
              Open this run in its own workspace
            </a>
          </p>
        </>
      ) : null}
    </section>
  );
}
