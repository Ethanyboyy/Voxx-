"use client";

import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Ratio, Chip, Ago, Truthless } from "@/components/observer/primitives";
import type { ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] WHAT IS DANGEROUS, RIGHT NOW.
 *
 * Conditions are listed in severity order and every one of them is a real
 * derived fact with a real source. There is no animated warning band and no
 * always-on "system nominal" badge — a health panel that always has something
 * urgent to show trains a reader to ignore it, which is worse than no panel.
 *
 * When nothing is wrong the panel says nothing is wrong AND says what it
 * checked, so "all clear" is a statement about specific conditions rather than
 * a reassuring colour.
 */

interface Condition {
  key: string;
  severity: "critical" | "warning" | "notice";
  label: string;
  detail: string;
}

const SEVERITY_TONE: Record<Condition["severity"], string> = {
  critical: "var(--danger)",
  warning: "var(--warning)",
  notice: "var(--accent-blue)",
};

function conditions(state: ObserverState): Condition[] {
  const health = state.health;
  const list: Condition[] = [];

  if (health.halted) {
    list.push({
      key: "halted",
      severity: "critical",
      label: "HALTED",
      detail: health.haltReason ?? "The global economic halt is engaged. No allocation can be approved.",
    });
  }

  for (const agent of health.suspendedAgents) {
    list.push({
      key: `suspended-${agent.id}`,
      severity: "critical",
      label: "SUSPENDED",
      detail: `${agent.name} — ${agent.reason ?? "no reason recorded"}. Only a human resume lifts this.`,
    });
  }

  if (health.escalationRefusals > 0) {
    list.push({
      key: "escalation",
      severity: "critical",
      label: "ESCALATION REFUSED",
      detail: `${health.escalationRefusals} attempt${health.escalationRefusals === 1 ? "" : "s"} to reach a protected target were refused in the last ${health.windowHours}h. This is a security event, not routine noise.`,
    });
  }

  for (const agent of health.stalledAgents) {
    list.push({
      key: `stalled-${agent.id}`,
      severity: "warning",
      label: "STALLED",
      detail: `${agent.name} has been in ${agent.state} without a heartbeat since ${new Date(agent.lastHeartbeatAt).toLocaleTimeString()}.`,
    });
  }

  for (const agent of health.staleLeases) {
    list.push({
      key: `lease-${agent.id}`,
      severity: "warning",
      label: "STALE LEASE",
      detail: `${agent.name} still holds a cycle lease that expired. A cycle likely died without releasing it; the next claim reclaims it.`,
    });
  }

  if (health.recentFailures.length > 0) {
    list.push({
      key: "failures",
      severity: "warning",
      label: "RECENT FAILURE",
      detail: `${health.recentFailures.length} failure or refusal event${health.recentFailures.length === 1 ? "" : "s"} in the last ${health.windowHours}h. Failed runs are preserved as evidence, never deleted.`,
    });
  }

  if (health.pendingApprovalCount > 0) {
    list.push({
      key: "approvals",
      severity: "notice",
      label: "APPROVAL REQUIRED",
      detail: `${health.pendingApprovalCount} capital request${health.pendingApprovalCount === 1 ? "" : "s"} waiting on a person. Nothing proceeds until one is answered.`,
    });
  }

  if (state.system.treasury.reservedCents > 0) {
    list.push({
      key: "reserved",
      severity: "notice",
      label: "CAPITAL RESERVED",
      detail: `Capital is set aside and unavailable to anything else. Reserved is not spent — it becomes spending only through the ledger.`,
    });
  }

  if (!state.provenance.realizedRevenueRecorded) {
    list.push({
      key: "no-revenue",
      severity: "notice",
      label: "NO REALIZED REVENUE",
      detail: "No revenue row with real provenance exists. Every revenue figure on this screen is absent rather than zero.",
    });
  }

  return list;
}

export function SystemHealth({ state }: { state: ObserverState }) {
  const list = conditions(state);
  const critical = list.filter((condition) => condition.severity === "critical").length;

  return (
    <InstrumentPanel className="overflow-hidden" live={critical > 0}>
      <PanelHeader
        eyebrow="System health"
        title={critical > 0 ? `${critical} critical` : list.length > 0 ? `${list.length} conditions` : "No conditions"}
        description={`Derived from real rows over a ${state.health.windowHours}-hour window. Nothing here is a decorative warning.`}
        actions={
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Capital pressure <Ratio value={state.health.capitalPressure} />
          </span>
        }
      />
      <Seam className="mt-4" />

      <div className="p-4">
        {list.length === 0 ? (
          <Truthless
            label="NO ADVERSE CONDITIONS"
            detail="Checked: halt state, agent suspensions, escalation refusals, stalled heartbeats, stale leases, recent failures, pending approvals and realized revenue."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((condition) => (
              <li
                key={condition.key}
                className="flex items-start gap-2.5 rounded-[var(--radius-xs)] border px-3 py-2.5"
                style={{
                  borderColor: `color-mix(in srgb, ${SEVERITY_TONE[condition.severity]} 28%, transparent)`,
                  background: `color-mix(in srgb, ${SEVERITY_TONE[condition.severity]} 6%, transparent)`,
                }}
              >
                <span className="mt-0.5 shrink-0">
                  <Chip tone={SEVERITY_TONE[condition.severity]}>{condition.label}</Chip>
                </span>
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">{condition.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.health.recentFailures.length > 0 ? (
        <>
          <Seam />
          <ul className="flex flex-col gap-0.5 px-4 py-3">
            {state.health.recentFailures.slice(0, 5).map((failure) => (
              <li key={failure.id} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate font-mono text-[var(--danger)]">{failure.type}</span>
                <Ago at={failure.at} className="shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </InstrumentPanel>
  );
}
