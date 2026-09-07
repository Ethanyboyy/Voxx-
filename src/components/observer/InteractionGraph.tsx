"use client";

import { useMemo } from "react";
import { InstrumentPanel, PanelHeader, Seam } from "@/components/ui/Instrument";
import { Chip, Truthless, stateColor } from "@/components/observer/primitives";
import type { ObserverState } from "@/lib/volara/observer";

/**
 * [P4-G] AGENT → MESSAGE → OPPORTUNITY → STRATEGY → ALLOCATION → APPROVAL.
 *
 * The graph exists to make one distinction impossible to miss: COMMUNICATION
 * is drawn in one visual language and AUTHORITY in another, and there is no
 * edge shape connecting them.
 *
 * Concretely — a message edge is a dashed grey line labelled INFORMATION ONLY,
 * and it terminates at the row it refers to. It never continues into the
 * allocation or approval column, because in the runtime it never does: nothing
 * on the execution path reads a message. The approval edge is solid and begins
 * at the human column, because that is the only place authority enters.
 *
 * Drawn as columns rather than as a force layout. A physics simulation would
 * imply relationships by proximity, and proximity is exactly the wrong thing to
 * imply here.
 */

interface GraphRow {
  agentId: string;
  agentName: string;
  agentState: string;
  messageCount: number;
  opportunityTitles: string[];
  strategyNames: string[];
  allocations: Array<{ id: string; status: string; cents: number }>;
  awaitingHuman: number;
}

export function InteractionGraph({ state }: { state: ObserverState }) {
  const rows = useMemo<GraphRow[]>(() => {
    return state.agents.map((agent) => {
      const messages = state.messages.filter((message) => message.fromAgentId === agent.id);
      const opportunities = state.opportunities.filter((o) => o.discoveredByAgentId === agent.id);
      const strategies = state.strategies.filter((s) => s.ownerAgentId === agent.id);
      const allocations = state.allocations.filter((a) => a.agentId === agent.id);
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentState: agent.runtimeState,
        messageCount: messages.length,
        opportunityTitles: opportunities.slice(0, 3).map((o) => o.title),
        strategyNames: strategies.slice(0, 3).map((s) => s.name),
        allocations: allocations.slice(0, 3).map((a) => ({
          id: a.id,
          status: a.status,
          cents: a.status === "REQUESTED" ? a.requestedCents : a.approvedCents,
        })),
        awaitingHuman: allocations.filter((a) => a.status === "REQUESTED").length,
      };
    });
  }, [state]);

  const hasAnything = rows.some(
    (row) =>
      row.messageCount > 0 ||
      row.opportunityTitles.length > 0 ||
      row.strategyNames.length > 0 ||
      row.allocations.length > 0
  );

  return (
    <InstrumentPanel className="overflow-hidden">
      <PanelHeader
        eyebrow="Interaction graph"
        title="Who did what, and what it led to"
        description="Communication and authority are drawn differently on purpose. A message edge never reaches the authorization column, because in the runtime it never does."
        actions={
          <div className="hidden items-center gap-2 sm:flex">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <span className="h-px w-5 border-t border-dashed border-[var(--border-strong)]" />
              Information
            </span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-[var(--accent)]">
              <span className="h-px w-5 bg-[var(--accent)]" />
              Authority
            </span>
          </div>
        }
      />
      <Seam className="mt-4" />

      <div className="overflow-x-auto p-4">
        {!hasAnything ? (
          <Truthless
            label="NO RECORDED INTERACTIONS"
            detail="No agent has sent a message, recorded an opportunity, proposed a strategy or requested capital yet."
          />
        ) : (
          <table className="w-full min-w-[820px] border-separate border-spacing-y-1.5 text-left">
            <thead>
              <tr className="vox-unit">
                <th className="w-[16%] px-2 pb-1 font-normal">Agent</th>
                <th className="w-[16%] px-2 pb-1 font-normal">Message</th>
                <th className="w-[20%] px-2 pb-1 font-normal">Opportunity</th>
                <th className="w-[20%] px-2 pb-1 font-normal">Strategy</th>
                <th className="w-[16%] px-2 pb-1 font-normal">Allocation</th>
                <th className="w-[12%] px-2 pb-1 font-normal text-[var(--accent)]">Human</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.agentId} className="align-top">
                  <td className="rounded-l-[var(--radius-xs)] bg-[var(--surface-hover)] px-2 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: stateColor(row.agentState) }}
                      />
                      <span className="truncate text-xs font-medium text-foreground">{row.agentName}</span>
                    </span>
                  </td>

                  {/* MESSAGE — dashed, and explicitly labelled as carrying nothing. */}
                  <td className="bg-[var(--surface-hover)] px-2 py-2.5">
                    {row.messageCount > 0 ? (
                      <span className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <span className="h-px w-4 shrink-0 border-t border-dashed border-[var(--border-strong)]" />
                          <span className="text-xs text-muted">{row.messageCount} sent</span>
                        </span>
                        <span className="vox-unit text-muted-foreground">INFORMATION ONLY</span>
                      </span>
                    ) : (
                      <span className="vox-unit text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="bg-[var(--surface-hover)] px-2 py-2.5">
                    {row.opportunityTitles.length > 0 ? (
                      <ul className="flex flex-col gap-0.5">
                        {row.opportunityTitles.map((title) => (
                          <li key={title} className="truncate text-xs text-muted">
                            {title}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="vox-unit text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="bg-[var(--surface-hover)] px-2 py-2.5">
                    {row.strategyNames.length > 0 ? (
                      <ul className="flex flex-col gap-0.5">
                        {row.strategyNames.map((name) => (
                          <li key={name} className="truncate text-xs text-muted">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="vox-unit text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="bg-[var(--surface-hover)] px-2 py-2.5">
                    {row.allocations.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {row.allocations.map((allocation) => (
                          <li key={allocation.id}>
                            <Chip
                              tone={
                                allocation.status === "APPROVED" || allocation.status === "CONSUMED"
                                  ? "var(--accent)"
                                  : allocation.status === "REQUESTED"
                                    ? "var(--warning)"
                                    : "var(--muted)"
                              }
                            >
                              {allocation.status}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="vox-unit text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* AUTHORITY — solid, and it starts here. Nothing to its left
                      produces it, which is the whole point of the column. */}
                  <td className="rounded-r-[var(--radius-xs)] bg-[var(--surface-hover)] px-2 py-2.5">
                    {row.awaitingHuman > 0 ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-px w-4 shrink-0 bg-[var(--accent)]" />
                        <span className="text-xs font-medium text-[var(--accent)]">
                          {row.awaitingHuman} pending
                        </span>
                      </span>
                    ) : (
                      <span className="vox-unit text-muted-foreground">NONE PENDING</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </InstrumentPanel>
  );
}
