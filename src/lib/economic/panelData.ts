// The shape the P&L panel renders, and the mapping from the server report to it.
//
// Deliberately NOT inside ProfitLossPanel.tsx. That file is a `"use client"`
// module, and a function exported from one cannot be CALLED on the server —
// only rendered as a component or passed as a prop. The Finance page is a
// server component that needs this mapping to produce the panel's initial
// props, so the mapping lives here, in a plain module both sides can import.
//
// (This was found by loading the page, not by typecheck: the boundary is a
// runtime rule, and `tsc` is happy to let a server file import a client
// function.)
import type { PnlReport } from "@/lib/economic/pnl";

export interface PnlPanelData {
  today: { realized: number; recorded: number; simulated: number };
  trailing7d: { realized: number; recorded: number };
  trailing30d: { realized: number; recorded: number };
  lifetime: { realized: number; recorded: number; entries: number };
  floor: { targetUsd: number; recordedActual: number; recordedShortfall: number; realizedShortfall: number };
  objective: { targetUsd: number; recordedActual: number; recordedShortfall: number };
  capital: {
    availableUsd: number | null;
    reason: string;
    policyCeilingUsd: number;
    policyRemainingUsd: number;
    halted: boolean;
    haltReason: string | null;
  };
  outlook: {
    activeExperimentCount: number;
    expectedNetProfitUsd: number;
    requiredCapitalUsd: number;
    maxAuthorizedLossUsd: number;
  };
}

/**
 * Flattens the server report into exactly what the panel renders.
 *
 * The projected figures stay in their own `outlook` object rather than being
 * merged into the window numbers — the same separation the report itself
 * enforces, carried through to the props so the component cannot accidentally
 * render a forecast as a result.
 */
export function toPanelData(pnl: PnlReport): PnlPanelData {
  return {
    today: {
      realized: pnl.today.realized.netUsd,
      recorded: pnl.today.recorded.netUsd,
      simulated: pnl.today.simulated.netUsd,
    },
    trailing7d: { realized: pnl.trailing7d.realized.netUsd, recorded: pnl.trailing7d.recorded.netUsd },
    trailing30d: { realized: pnl.trailing30d.realized.netUsd, recorded: pnl.trailing30d.recorded.netUsd },
    lifetime: {
      realized: pnl.lifetime.realized.netUsd,
      recorded: pnl.lifetime.recorded.netUsd,
      entries: pnl.lifetime.recorded.entryCount,
    },
    floor: {
      targetUsd: pnl.floor.targetUsd,
      recordedActual: pnl.floor.recorded.actualUsd,
      recordedShortfall: pnl.floor.recorded.shortfallUsd,
      realizedShortfall: pnl.floor.realized.shortfallUsd,
    },
    objective: {
      targetUsd: pnl.objective.targetUsd,
      recordedActual: pnl.objective.recorded.actualUsd,
      recordedShortfall: pnl.objective.recorded.shortfallUsd,
    },
    capital: {
      availableUsd: pnl.capital.availableUsd,
      reason: pnl.capital.reason,
      policyCeilingUsd: pnl.capital.policyCeilingUsd,
      policyRemainingUsd: pnl.capital.policyRemainingUsd,
      halted: pnl.capital.halted,
      haltReason: pnl.capital.haltReason,
    },
    outlook: {
      activeExperimentCount: pnl.outlook.activeExperimentCount,
      expectedNetProfitUsd: pnl.outlook.expectedNetProfitUsd,
      requiredCapitalUsd: pnl.outlook.requiredCapitalUsd,
      maxAuthorizedLossUsd: pnl.outlook.maxAuthorizedLossUsd,
    },
  };
}
