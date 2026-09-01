"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { InstrumentPanel, PanelHeader, Readout, Meter, Seam } from "@/components/ui/Instrument";
import { toPanelData, type PnlPanelData } from "@/lib/economic/panelData";

/**
 * The economic loop's instrument panel.
 *
 * DESIGN CONSTRAINT, not a style choice: this surface must never let a
 * projection read as profit. So the layout separates them physically —
 * realized/recorded results sit in the measurement band, expectations sit
 * below a seam under an explicit "PROJECTED" mark, and the two never share a
 * row, a colour or a type scale. A reader skimming for "what did we make"
 * cannot accidentally land on a forecast.
 *
 * The same applies to capital: when VOX cannot determine a cash position it
 * says so in words, rather than rendering a zero that would read as a
 * measured balance.
 */

function usd(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function ProfitLossPanel({ initial }: { initial: PnlPanelData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<null | "tick" | "halt">(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/economic/pnl");
    if (!res.ok) return;
    const body = await res.json();
    setData(toPanelData(body.pnl));
  }

  async function runTick() {
    setBusy("tick");
    setMessage(null);
    try {
      const res = await fetch("/api/economic/tick", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "The tick could not be run.");
        return;
      }
      const t = body.tick;
      setMessage(
        t.performed
          ? `Tick ${t.status.toLowerCase()}: ${t.evaluated} contract(s) evaluated — ${t.killed} killed, ${t.held} held, ${t.scaled} awaiting a human.${t.note ? ` ${t.note}` : ""}`
          : "This hour's tick already ran; nothing was re-evaluated."
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleHalt() {
    setBusy("halt");
    setMessage(null);
    try {
      const res = await fetch("/api/economic/halt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          data.capital.halted ? { action: "resume" } : { action: "halt", reason: "Halted from Economic Command." }
        ),
      });
      if (res.ok) {
        setMessage(
          data.capital.halted
            ? "Economic engine resumed. Autonomous spend and scheduler evaluation are permitted again."
            : "Economic engine halted. No economic execution or autonomous spend can occur."
        );
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const { floor, objective, capital, outlook } = data;

  return (
    <InstrumentPanel className="mt-6 overflow-hidden" registration>
      <PanelHeader
        eyebrow="Economic loop"
        title="Profit & loss"
        description="Measured from the ledger. Realized means confirmed against an external system of record; recorded means a human entered it and nothing has verified it."
      />

      {/*
        The controls sit in their own strip rather than in PanelHeader's
        `actions` slot. At 390px that slot takes roughly half the header width,
        which squeezed this panel's description into a nine-line column with a
        large empty block beside it — the layout only read correctly on a wide
        screen. A full-width strip works at both sizes, and right-aligning it
        from `sm` up keeps the desktop reading the panel is used to.
      */}
      <div className="flex flex-wrap items-center gap-2 px-5 pt-3 sm:justify-end">
        <Button size="sm" variant="secondary" onClick={runTick} disabled={busy !== null}>
          {busy === "tick" ? "Running…" : "Run tick"}
        </Button>
        <Button size="sm" variant={capital.halted ? "primary" : "danger"} onClick={toggleHalt} disabled={busy !== null}>
          {capital.halted ? "Resume engine" : "Halt engine"}
        </Button>
      </div>

      {capital.halted ? (
        <div className="mx-5 mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-foreground">
          <strong className="font-semibold">Global economic halt engaged.</strong>{" "}
          {capital.haltReason ?? "No reason recorded."} No economic execution or autonomous spend can occur — enforced
          in service code, not by hiding this panel.
        </div>
      ) : null}

      {message ? <p className="mx-5 mt-3 text-xs leading-relaxed text-muted">{message}</p> : null}

      {/* ---- Measured. Every number below came from a ledger row. ---- */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-4 sm:grid-cols-4">
        <Readout label="Today · realized" value={usd(data.today.realized)} note="Externally confirmed" />
        <Readout label="Today · recorded" value={usd(data.today.recorded)} note="Human-entered, unverified" />
        <Readout label="7 days · recorded" value={usd(data.trailing7d.recorded)} />
        <Readout label="30 days · recorded" value={usd(data.trailing30d.recorded)} />
      </div>

      <div className="px-5 pb-4">
        <Meter
          label={`Daily floor · ${usd(floor.targetUsd)}`}
          value={Math.max(0, floor.recordedActual)}
          max={floor.targetUsd}
          tone={floor.recordedShortfall > 0 ? "warning" : "success"}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {floor.recordedShortfall > 0
            ? `${usd(floor.recordedShortfall)} below the floor on recorded results — ${usd(floor.realizedShortfall)} below on realized.`
            : `Floor met on recorded results. Realized shortfall: ${usd(floor.realizedShortfall)}.`}
        </p>
        <div className="mt-3">
          <Meter
            label={`Monthly objective · ${usd(objective.targetUsd)}`}
            value={Math.max(0, objective.recordedActual)}
            max={objective.targetUsd}
            tone={objective.recordedShortfall > 0 ? "warning" : "success"}
          />
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {usd(objective.recordedShortfall)} below the $100,000 / 30-day objective on recorded results.
          </p>
        </div>
      </div>

      <Seam />

      {/* ---- Capital. A null balance is stated in words, never drawn as 0. ---- */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-4 sm:grid-cols-3">
        <Readout
          label="Available capital"
          value={capital.availableUsd === null ? "Unknown" : usd(capital.availableUsd)}
          note={capital.availableUsd === null ? "No account connected" : undefined}
        />
        <Readout label="Autonomous ceiling" value={usd(capital.policyCeilingUsd)} note="Policy limit, not cash" />
        <Readout label="Ceiling remaining" value={usd(capital.policyRemainingUsd)} />
      </div>
      <p className="px-5 pb-4 text-[11px] leading-relaxed text-muted-foreground">{capital.reason}</p>

      <Seam />

      {/* ---- Projected. Physically separated, explicitly marked, never summed
           with anything above this line. ---- */}
      <div className="px-5 py-4">
        <p className="vox-eyebrow text-warning">Projected — not profit</p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Readout label="Live contracts" value={String(outlook.activeExperimentCount)} />
          <Readout label="Expected net" value={usd(outlook.expectedNetProfitUsd)} note="Contract estimate" />
          <Readout label="Capital required" value={usd(outlook.requiredCapitalUsd)} />
          <Readout label="Authorized downside" value={usd(outlook.maxAuthorizedLossUsd)} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          These are expectations written into experiment contracts. They are stored in a different table from the
          ledger and are never added to any figure above.
        </p>
      </div>
    </InstrumentPanel>
  );
}
