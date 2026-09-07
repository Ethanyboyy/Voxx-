"use client";

import { InstrumentPanel, PanelHeader, Readout, Seam } from "@/components/ui/Instrument";
import {
  Money,
  Ratio,
  Chip,
  Ago,
  IdTag,
  Truthless,
  ProvenanceTag,
  stateColor,
} from "@/components/observer/primitives";
import type { ObserverState } from "@/lib/volara/observer";
import type { Strategy } from "@/generated/prisma/client";

/**
 * [P4-G] AGENT AND STRATEGY DETAIL.
 *
 * Both panels lead with GOVERNANCE rather than with economics, because what an
 * entity is permitted to do is the thing a reader most needs and the thing a
 * conventional dashboard would bury. The agent panel says in plain words what
 * it can request, what it cannot authorize, and why it is stopped if it is.
 *
 * A strategy being ACTIVE is never allowed to imply that it earned anything:
 * the status band and the realized band are separate, and the realized one
 * reads NO LEDGER ACTIVITY until real rows exist.
 */

const STRATEGY_TONE: Record<string, string> = {
  DRAFT: "var(--muted)",
  PROPOSED: "var(--warning)",
  ACTIVE: "var(--accent)",
  TESTING: "var(--accent-blue)",
  MEASURING: "var(--accent-blue)",
  PAUSED: "var(--accent-steel)",
  KILLED: "var(--danger)",
  COMPLETED: "var(--success)",
  REPLICATED: "var(--core-2)",
};

export function AgentDetail({ state, agentId, onClose }: { state: ObserverState; agentId: string; onClose: () => void }) {
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return null;

  const metrics = agent.metrics;
  const ownedStrategies = state.strategies.filter((strategy) => strategy.ownerAgentId === agent.id);
  const allocations = state.allocations.filter((allocation) => allocation.agentId === agent.id);
  const messages = state.messages.filter((message) => message.fromAgentId === agent.id).slice(0, 6);
  const suspended = agent.runtimeState === "SUSPENDED";

  return (
    <InstrumentPanel depth="float" className="overflow-hidden">
      <PanelHeader
        eyebrow={agent.role ?? "Agent"}
        title={agent.name}
        description={agent.description}
        actions={
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground"
          >
            Close
          </button>
        }
      />
      <Seam className="mt-4" />

      {/* GOVERNANCE FIRST. */}
      <div className="px-5 py-4">
        <p className="vox-eyebrow mb-2">Governance</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-xs)] border border-[var(--border)] px-3 py-2.5">
            <p className="vox-unit">May request</p>
            <p className="mt-0.5 text-sm text-foreground">
              {agent.maxRequestCents === 0 ? (
                <span className="text-muted">Nothing — ceiling is zero until a human raises it</span>
              ) : (
                <>
                  up to <Money cents={agent.maxRequestCents} /> per allocation
                </>
              )}
            </p>
          </div>
          <div className="rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[var(--accent-muted)] px-3 py-2.5">
            <p className="vox-unit text-[var(--accent)]">Cannot authorize</p>
            <p className="mt-0.5 text-sm text-muted">
              Every allocation needs a human approval. This agent cannot approve its own request, another agent&apos;s,
              or raise any ceiling.
            </p>
          </div>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-xs)] border border-[var(--border)] px-3 py-2.5">
            <p className="vox-unit">Capabilities ({agent.allowedCapabilities.length})</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {agent.allowedCapabilities.length === 0 ? (
                <li className="vox-unit text-muted-foreground">NONE GRANTED</li>
              ) : (
                agent.allowedCapabilities.map((capability) => (
                  <li key={capability}>
                    <Chip tone="var(--accent-steel)">{capability}</Chip>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="rounded-[var(--radius-xs)] border border-[var(--border)] px-3 py-2.5">
            <p className="vox-unit">Tool restriction</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {agent.allowedTools === null ? (
                <li className="vox-unit text-muted-foreground">NONE BEYOND CAPABILITIES</li>
              ) : agent.allowedTools.length === 0 ? (
                <li className="vox-unit text-muted-foreground">NO TOOLS PERMITTED</li>
              ) : (
                agent.allowedTools.map((tool) => (
                  <li key={tool}>
                    <Chip tone="var(--accent-blue)">{tool}</Chip>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {suspended ? (
          <div className="mt-2 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-muted)] px-3 py-2.5">
            <p className="vox-unit text-[var(--danger)]">Suspended</p>
            <p className="mt-0.5 text-sm text-muted">
              {agent.suspendedReason ?? "No reason was recorded."} Suspended <Ago at={agent.suspendedAt} />. Only a
              human resume can lift this.
            </p>
          </div>
        ) : null}
      </div>

      <Seam />

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Readout label="State" value={<span className="text-base" style={{ color: stateColor(agent.runtimeState) }}>{agent.runtimeState.replace(/_/g, " ")}</span>} note={agent.currentStage ? <span className="vox-unit">stage {agent.currentStage}</span> : null} />
        <Readout label="Autonomy" value={<span className="text-base">{agent.autonomyMode.replace(/_/g, " ")}</span>} note={<span className="vox-unit">Initiative, not authority</span>} />
        <Readout label="Cycles" value={<span className="tabular-nums text-base">{metrics?.cycleCount ?? 0}</span>} note={<span className="vox-unit">{metrics?.failureCount ?? 0} failures</span>} />
        <Readout label="Heartbeat" value={<span className="text-base"><Ago at={agent.heartbeatAt} /></span>} note={<span className="vox-unit">health {agent.health}</span>} />
      </div>

      <Seam />

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Readout label="Requested" value={<Money cents={metrics?.capitalRequestedCents ?? 0} />} note={<ProvenanceTag kind="REQUESTED" />} />
        <Readout label="Approved" value={<Money cents={metrics?.capitalAllocatedCents ?? 0} />} note={<ProvenanceTag kind="RESERVED" />} />
        <Readout label="Deployed" value={<Money cents={metrics?.capitalDeployedCents ?? 0} />} note={<ProvenanceTag kind="RECORDED" />} />
        <Readout
          label="Revenue"
          value={metrics && metrics.revenueCents > 0 ? <Money cents={metrics.revenueCents} /> : <span className="vox-unit text-muted-foreground">NONE RECORDED</span>}
          note={<span className="vox-unit">ROI <Ratio value={metrics?.roi ?? null} /></span>}
        />
      </div>

      <Seam />

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Strategies owned</p>
          {ownedStrategies.length === 0 ? (
            <p className="vox-unit text-muted-foreground">NONE</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {ownedStrategies.slice(0, 5).map((strategy) => (
                <li key={strategy.id} className="flex items-center gap-1.5 text-xs">
                  <Chip tone={STRATEGY_TONE[strategy.status] ?? "var(--muted)"}>{strategy.status}</Chip>
                  <span className="truncate text-muted">{strategy.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Allocations</p>
          {allocations.length === 0 ? (
            <p className="vox-unit text-muted-foreground">NONE REQUESTED</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {allocations.slice(0, 5).map((allocation) => (
                <li key={allocation.id} className="flex items-center gap-1.5 text-xs">
                  <Chip tone={allocation.status === "APPROVED" ? "var(--accent)" : "var(--warning)"}>
                    {allocation.status}
                  </Chip>
                  <Money
                    cents={allocation.status === "REQUESTED" ? allocation.requestedCents : allocation.approvedCents}
                    className="text-muted"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Recent messages</p>
          {messages.length === 0 ? (
            <p className="vox-unit text-muted-foreground">NO RECENT AGENT COMMUNICATION</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {messages.map((message) => (
                <li key={message.id} className="min-w-0 text-xs">
                  <span className="flex items-center gap-1.5">
                    <Chip tone="var(--muted)">{message.kind}</Chip>
                    <span className="truncate text-muted">{message.subject}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-2.5">
        <IdTag id={agent.id} label="agent" />
        {agent.recentTransitions[0] ? (
          <IdTag id={agent.recentTransitions[0].correlationId} label="last cycle" />
        ) : null}
      </div>
    </InstrumentPanel>
  );
}

export function StrategyDetail({
  state,
  strategy,
  onClose,
}: {
  state: ObserverState;
  strategy: Strategy;
  onClose: () => void;
}) {
  const allocations = state.allocations.filter((allocation) => allocation.strategyId === strategy.id);
  const requested = allocations.reduce((sum, a) => sum + (a.status === "REQUESTED" ? a.requestedCents : 0), 0);
  const approved = allocations
    .filter((a) => a.status === "APPROVED" || a.status === "CONSUMED")
    .reduce((sum, a) => sum + a.approvedCents, 0);
  const deployed = allocations.reduce((sum, a) => sum + a.consumedCents, 0);
  const owner = state.agents.find((agent) => agent.id === strategy.ownerAgentId);
  const lessons = parseList(strategy.lessons);
  const assumptions = parseList(strategy.assumptions);
  const activated = strategy.activatedByHumanAt !== null;

  return (
    <InstrumentPanel depth="float" className="overflow-hidden">
      <PanelHeader
        eyebrow="Strategy"
        title={strategy.name}
        description={strategy.hypothesis}
        actions={
          <div className="flex items-center gap-2">
            <Chip tone={STRATEGY_TONE[strategy.status] ?? "var(--muted)"}>{strategy.status}</Chip>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-xs)] border border-[var(--border-strong)] px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground"
            >
              Close
            </button>
          </div>
        }
      />
      <Seam className="mt-4" />

      {/* Activation is a fact about a human act, and it is stated as one —
          never as evidence that the strategy worked. */}
      <div className="px-5 py-3">
        <div
          className={`rounded-[var(--radius-xs)] border px-3 py-2.5 ${activated ? "border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--accent-muted)]" : "border-dashed border-border"}`}
        >
          <p className="vox-unit" style={{ color: activated ? "var(--accent)" : undefined }}>
            {activated ? "Human-activated" : "Not activated"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {activated ? (
              <>
                Activated <Ago at={strategy.activatedByHumanAt!.toString()} /> with a cap of{" "}
                <Money cents={strategy.maxCapitalCents} />. Activation permits requests under this thesis; it is not
                evidence that any of them succeeded.
              </>
            ) : (
              "No human has activated this strategy, so the governor admits no capital request under it."
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-3 sm:grid-cols-4">
        <Readout label="Cap" value={<Money cents={strategy.maxCapitalCents} />} note={<span className="vox-unit">Human-set</span>} />
        <Readout label="Requested" value={<Money cents={requested} />} note={<ProvenanceTag kind="REQUESTED" />} />
        <Readout label="Reserved" value={<Money cents={approved} />} note={<ProvenanceTag kind="RESERVED" />} />
        <Readout label="Deployed" value={<Money cents={deployed} />} note={<ProvenanceTag kind="RECORDED" />} />
      </div>

      <Seam />

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Owner</p>
          <p className="text-xs text-muted">{owner ? `${owner.name} · ${owner.role ?? "—"}` : "Human-authored"}</p>
          {strategy.mechanism ? (
            <>
              <p className="vox-eyebrow mb-1 mt-3">Mechanism</p>
              <p className="text-xs leading-relaxed text-muted">{strategy.mechanism}</p>
            </>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Stated assumptions</p>
          {assumptions.length === 0 ? (
            <p className="vox-unit text-muted-foreground">NONE STATED</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <p className="vox-eyebrow mb-1.5">Lessons recorded</p>
          {lessons.length === 0 ? (
            <p className="vox-unit text-muted-foreground">NO LESSONS RECORDED</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
              {lessons.map((lesson) => (
                <li key={lesson}>{lesson}</li>
              ))}
            </ul>
          )}
          {strategy.outcomeReason ? (
            <p className="mt-2 text-xs text-muted">
              <span className="vox-unit">Outcome</span> {strategy.outcomeReason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-2.5">
        <IdTag id={strategy.id} label="strategy" />
        {strategy.correlationId ? <IdTag id={strategy.correlationId} label="trace" /> : null}
      </div>
    </InstrumentPanel>
  );
}

/** Parses a JSON string[] column defensively — corrupt values read as empty. */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Strategies, as a selectable list. Status is never conflated with success. */
export function StrategyList({
  state,
  selectedId,
  onSelect,
}: {
  state: ObserverState;
  selectedId: string | null;
  onSelect: (strategyId: string | null) => void;
}) {
  return (
    <InstrumentPanel className="overflow-hidden">
      <PanelHeader
        eyebrow="Strategies"
        title={`${state.strategies.length} recorded`}
        description="A strategy is a standing rule set that bounds what agents may put forward. Only a human activates one."
      />
      <Seam className="mt-4" />
      <div className="p-4">
        {state.strategies.length === 0 ? (
          <Truthless
            label="NO ACTIVE STRATEGIES"
            detail="No agent has proposed a strategy and none has been authored by hand. Capital cannot be requested without one."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {state.strategies.slice(0, 12).map((strategy) => (
              <li key={strategy.id}>
                <button
                  type="button"
                  onClick={() => onSelect(selectedId === strategy.id ? null : strategy.id)}
                  aria-pressed={selectedId === strategy.id}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius-xs)] border px-3 py-2 text-left transition-colors ${
                    selectedId === strategy.id
                      ? "border-[var(--accent)] bg-[var(--accent-muted)]"
                      : "border-[var(--border)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <Chip tone={STRATEGY_TONE[strategy.status] ?? "var(--muted)"}>{strategy.status}</Chip>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{strategy.name}</span>
                  {strategy.activatedByHumanAt ? (
                    <Money cents={strategy.maxCapitalCents} className="shrink-0 text-[11px] text-muted" />
                  ) : (
                    <span className="vox-unit shrink-0 text-muted-foreground">NO CAP</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </InstrumentPanel>
  );
}
