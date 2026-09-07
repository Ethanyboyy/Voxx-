"use client";

import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import {
  Money,
  Ratio,
  Chip,
  Ago,
  Truthless,
  stateColor,
  ACTIVE_STATES,
} from "@/components/observer/primitives";
import { cn } from "@/lib/utils/cn";
import type { ObservedAgent, ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] THE FIVE AGENTS.
 *
 * Two design rules, both from the brief and both load-bearing:
 *
 *   ROLE IS NOT AUTHORITY. Every card shows the same governance line — request
 *   ceiling, capability count, and the fact that none of them can authorize —
 *   so the UI never suggests the OPERATOR has powers the SCOUT lacks. It
 *   doesn't; they differ in what they look at.
 *
 *   ONLY REAL ACTIVITY GLOWS. `live` is set from the agent's actual runtime
 *   state, so a still screen means a still runtime. A card that pulsed while
 *   nothing was happening would be exactly the fake autonomy this phase exists
 *   to avoid.
 */

const ROLE_BLURB: Record<string, string> = {
  SCOUT: "Surfaces unexamined ledger rows",
  ANALYST: "Challenges recorded economics",
  STRATEGIST: "Drafts strategies for human activation",
  OPERATOR: "Requests capital under an active strategy",
  AUDITOR: "Re-derives treasury conservation",
};

function AgentCard({
  agent,
  pendingCount,
  messageCount,
  onSelect,
  selected,
}: {
  agent: ObservedAgent;
  pendingCount: number;
  messageCount: number;
  onSelect: () => void;
  selected: boolean;
}) {
  const color = stateColor(agent.runtimeState);
  const active = ACTIVE_STATES.has(agent.runtimeState);
  const suspended = agent.runtimeState === "SUSPENDED";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "instrument group relative flex w-full flex-col gap-2.5 rounded-[var(--radius-sm)] p-3.5 text-left transition-[transform,box-shadow] duration-500 [transition-timing-function:var(--ease-luxury)]",
        "hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        selected && "ring-1 ring-[var(--accent)]",
        active && "vox-signal-active"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="vox-headline truncate text-sm">{agent.name}</p>
          <p className="vox-unit mt-0.5 truncate">{agent.role ?? "UNASSIGNED"}</p>
        </div>
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          {active ? (
            <span
              className="vox-status-dot absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ background: color }}
            />
          ) : null}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {agent.role ? ROLE_BLURB[agent.role] : agent.description}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={color}>{agent.runtimeState.replace(/_/g, " ")}</Chip>
        {agent.currentStage ? <Chip tone="var(--accent-blue)">{agent.currentStage}</Chip> : null}
        {suspended ? <Chip tone="var(--danger)">Suspended</Chip> : null}
        {pendingCount > 0 ? <Chip tone="var(--warning)">{pendingCount} awaiting human</Chip> : null}
      </div>

      {/* Economics, derived. Zeros are real zeros here — an agent that has
          requested nothing has deployed nothing — but revenue stays null-aware. */}
      <dl className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-2.5 text-[11px]">
        <div className="min-w-0">
          <dt className="vox-unit">Deployed</dt>
          <dd className="mt-0.5 truncate">
            <Money cents={agent.metrics?.capitalDeployedCents ?? null} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="vox-unit">Revenue</dt>
          <dd className="mt-0.5 truncate">
            <Money cents={agent.metrics && agent.metrics.revenueCents > 0 ? agent.metrics.revenueCents : null} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="vox-unit">ROI</dt>
          <dd className="mt-0.5 truncate">
            <Ratio value={agent.metrics?.roi ?? null} />
          </dd>
        </div>
      </dl>

      {/* THE GOVERNANCE LINE. Identical on every card, on purpose. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>May request {agent.maxRequestCents === 0 ? "nothing" : <Money cents={agent.maxRequestCents} />}</span>
        <span aria-hidden="true">·</span>
        <span>Cannot authorize</span>
        <span aria-hidden="true">·</span>
        <span>{agent.allowedCapabilities.length} capabilities</span>
      </p>

      <p className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {messageCount} message{messageCount === 1 ? "" : "s"} · {agent.metrics?.cycleCount ?? 0} cycles
        </span>
        <Ago at={agent.lastActivityAt} />
      </p>
    </button>
  );
}

export function AgentSociety({
  state,
  selectedAgentId,
  onSelectAgent,
}: {
  state: ObserverState;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
}) {
  const pendingByAgent = new Map<string, number>();
  for (const approval of state.pendingApprovals) {
    if (!approval.agent) continue;
    pendingByAgent.set(approval.agent.id, (pendingByAgent.get(approval.agent.id) ?? 0) + 1);
  }
  const messagesByAgent = new Map<string, number>();
  for (const message of state.messages) {
    if (!message.fromAgentId) continue;
    messagesByAgent.set(message.fromAgentId, (messagesByAgent.get(message.fromAgentId) ?? 0) + 1);
  }

  return (
    <InstrumentPanel className="overflow-hidden">
      <PanelHeader
        eyebrow="Agent society"
        title={`${state.agents.length} persistent agents`}
        description="Roles divide attention, not privilege. Every agent holds exactly the capabilities a human granted it, and none of them can authorize its own work."
      />
      <Seam className="mt-4" />

      <div className="p-4">
        {state.agents.length === 0 ? (
          <Truthless
            label="NO AGENTS SEEDED"
            detail="The Volara roster has not been created for this account yet. Seeding creates five agents with read-only capabilities and a zero capital ceiling."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                pendingCount={pendingByAgent.get(agent.id) ?? 0}
                messageCount={messagesByAgent.get(agent.id) ?? 0}
                selected={selectedAgentId === agent.id}
                onSelect={() => onSelectAgent(selectedAgentId === agent.id ? null : agent.id)}
              />
            ))}
          </div>
        )}
      </div>
    </InstrumentPanel>
  );
}
