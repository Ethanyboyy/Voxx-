"use client";

import { InstrumentPanel, PanelHeader, Readout, Seam } from "@/components/ui/Instrument";
import { StateIndicator } from "@/components/ui/StateIndicator";
import { Money, Ratio, Chip, Ago, ProvenanceTag, PipelineStage, Truthless } from "@/components/observer/primitives";
import type { ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] THE CENTRE OF THE OBSERVER — what the system is, right now.
 *
 * Every figure on this panel comes from the derived treasury and the derived
 * metrics; nothing is stored for display and nothing is computed in the
 * browser. The capital row is deliberately ordered ceiling → spent → reserved →
 * available, because that is the actual arithmetic, and showing it in that
 * order makes the relationship legible without a chart.
 *
 * The single most important thing this panel does is refuse to imply revenue.
 * If no ledger row with real provenance exists, it says so in words, in the
 * place a revenue number would otherwise sit.
 */

function runtimeStatus(state: ObserverState): { color: string; label: string; detail: string; pulse: boolean } {
  if (state.health.halted) {
    return {
      color: "var(--danger)",
      label: "HALTED",
      detail: state.health.haltReason ?? "Global economic halt engaged",
      pulse: false,
    };
  }
  const working = state.agents.filter((agent) => agent.runtimeState !== "IDLE" && agent.runtimeState !== "SUSPENDED");
  if (working.length > 0) {
    return {
      color: "var(--core-thinking)",
      label: "RUNNING",
      detail: `${working.length} of ${state.agents.length} agents in a cycle`,
      pulse: true,
    };
  }
  if (state.health.pendingApprovalCount > 0) {
    return {
      color: "var(--core-waiting)",
      label: "AWAITING HUMAN",
      detail: `${state.health.pendingApprovalCount} decision${state.health.pendingApprovalCount === 1 ? "" : "s"} pending`,
      pulse: true,
    };
  }
  return {
    color: "var(--core-idle)",
    label: "RUNTIME IDLE",
    detail: state.agents.length === 0 ? "No agents seeded" : "No cycle in progress",
    pulse: false,
  };
}

export function GlobalState({ state }: { state: ObserverState }) {
  const status = runtimeStatus(state);
  const treasury = state.system.treasury;

  // Pipeline reach is measured against real rows, never against a step counter.
  const anyOpportunity = state.opportunities.length > 0;
  const anyStrategy = state.strategies.length > 0;
  const anyRequest = state.allocations.some((a) => a.status === "REQUESTED");
  const anyApproved = state.allocations.some((a) => a.status === "APPROVED" || a.status === "CONSUMED");
  const anySpend = treasury.spentCents > 0;

  return (
    <InstrumentPanel depth="raised" registration live={status.pulse} className="overflow-hidden">
      {/* The status indicator carries a sentence of detail ("3 of 5 agents in a
          cycle"), and `PanelHeader` keeps its actions at `shrink-0`. On a phone
          that starves the title column until the heading truncates to "System
          s..." and the description wraps one word per line. Stacking below the
          text on narrow viewports gives both their full width; from `sm` up the
          indicator returns to the right of the heading. */}
      <PanelHeader
        className="flex-col gap-3 sm:flex-row sm:gap-4"
        eyebrow="Global Observer"
        title="System state"
        description="Every figure is derived from the ledger and the runtime's own rows at read time. Nothing here is stored for display."
        actions={
          <StateIndicator color={status.color} label={status.label} detail={status.detail} pulse={status.pulse} />
        }
      />

      <Seam className="mt-4" />

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Readout
          label="Ceiling"
          value={<Money cents={treasury.ceilingCents} emphasis />}
          note={<span className="vox-unit">Human-set limit</span>}
        />
        <Readout
          label="Spent"
          value={<Money cents={treasury.spentCents} emphasis />}
          note={<ProvenanceTag kind="RECORDED" />}
        />
        <Readout
          label="Reserved"
          value={<Money cents={treasury.reservedCents} emphasis />}
          note={<ProvenanceTag kind="RESERVED" />}
          live={treasury.reservedCents > 0}
        />
        <Readout
          label="Available"
          value={<Money cents={treasury.availableCents} emphasis />}
          note={<span className="vox-unit">Ceiling − spent − reserved</span>}
        />
      </div>

      <Seam />

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Readout
          label="Realized revenue"
          value={
            state.provenance.realizedRevenueRecorded ? (
              <Money cents={state.system.revenueCents} emphasis />
            ) : (
              <span className="vox-unit text-muted-foreground">NONE RECORDED</span>
            )
          }
          note={<ProvenanceTag kind="RECORDED" />}
        />
        <Readout
          label="Net profit"
          value={
            state.provenance.realizedRevenueRecorded || state.provenance.realizedExpenseRecorded ? (
              <Money cents={state.system.netProfitCents} emphasis />
            ) : (
              <span className="vox-unit text-muted-foreground">NO LEDGER ACTIVITY</span>
            )
          }
          note={<ProvenanceTag kind="DERIVED" />}
        />
        <Readout
          label="Return on deployed"
          value={<Ratio value={state.system.roi} className="vox-headline" />}
          note={<span className="vox-unit">Null until capital is deployed</span>}
        />
        <Readout
          label="Win rate"
          value={<Ratio value={state.system.winRate} className="vox-headline" />}
          note={<span className="vox-unit">Settled opportunities only</span>}
        />
      </div>

      {/* The provenance disclosure. This is the sentence that keeps every
          number above honest, so it sits with them rather than in a footnote. */}
      <div className="mx-5 mb-4 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-hover)] px-3.5 py-2.5">
        <p className="flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-muted">
          <Chip tone={state.provenance.externalConfirmationAvailable ? "var(--success)" : "var(--accent-steel)"}>
            {state.provenance.externalConfirmationAvailable ? "Externally confirmed" : "Internal ledger only"}
          </Chip>
          {state.provenance.externalConfirmationNote}
          {state.provenance.simulatedEntriesExcludedCents > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              Simulated entries totalling <Money cents={state.provenance.simulatedEntriesExcludedCents} /> are excluded
              from every figure above.
            </span>
          ) : null}
        </p>
      </div>

      <Seam />

      <div className="px-5 py-4">
        <p className="vox-eyebrow mb-2.5">Capital pipeline</p>
        {anyOpportunity ? (
          <ol className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
            <PipelineStage
              label="Opportunity"
              reached={anyOpportunity}
              tone="var(--accent-blue)"
              value={state.opportunities.length}
              detail="in the shared ledger"
            />
            <PipelineStage
              label="Strategy"
              reached={anyStrategy}
              tone="var(--accent-2)"
              value={state.strategies.length}
              detail={`${state.system.activeStrategies} human-activated`}
            />
            <PipelineStage
              label="Requested"
              reached={anyRequest}
              tone="var(--warning)"
              value={<Money cents={treasury.pendingCents} />}
              detail="awaiting a person"
            />
            <PipelineStage
              label="Reserved"
              reached={anyApproved}
              tone="var(--accent)"
              value={<Money cents={treasury.reservedCents} />}
              detail="approved, not spent"
            />
            <PipelineStage
              label="Spent"
              reached={anySpend}
              tone="var(--core-executing)"
              value={<Money cents={treasury.spentCents} />}
              detail="left the ledger"
            />
            <PipelineStage
              label="Revenue"
              reached={state.provenance.realizedRevenueRecorded}
              tone="var(--success)"
              value={<Money cents={state.system.revenueCents} />}
              detail="recorded against an asset"
            />
          </ol>
        ) : (
          <Truthless
            label="NO ACTIVE OPPORTUNITIES"
            detail="The shared ledger has no rows in play, so the pipeline has nothing to show. It will populate when an agent records an opportunity or you add one."
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border)] px-5 py-2.5 text-[11px] text-muted-foreground">
        <span>
          Snapshot <Ago at={state.generatedAt} />
        </span>
        <span>
          {state.health.agentsActiveRecently} of {state.health.agentCount} agents active in the last{" "}
          {state.health.windowHours}h
        </span>
        <span>
          Capital pressure <Ratio value={state.health.capitalPressure} />
        </span>
      </div>
    </InstrumentPanel>
  );
}
