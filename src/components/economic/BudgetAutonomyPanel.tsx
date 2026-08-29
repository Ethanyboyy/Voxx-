"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

export interface BudgetSummary {
  maxAutonomousSpendUsd: number;
  totalSpentUsd: number;
  remainingAutonomousUsd: number;
}

function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/**
 * The economic decision/control layer's UI: what the Supervisor may spend
 * autonomously (via the economic.record_expense tool, gated by
 * evaluateSpendPolicy — see src/lib/economic/policy.ts) and VOX's overall
 * autonomy posture. Never connected to a real payment method — this is a
 * decision layer only.
 */
export function BudgetAutonomyPanel({
  initialBudget,
  initialAutonomyMode,
}: {
  initialBudget: BudgetSummary;
  initialAutonomyMode: string;
}) {
  const [budget, setBudget] = useState(initialBudget);
  const [autonomyMode, setAutonomyMode] = useState(initialAutonomyMode);
  const [draftLimit, setDraftLimit] = useState(String(initialBudget.maxAutonomousSpendUsd));
  const [saving, setSaving] = useState(false);

  async function saveLimit() {
    const amount = Number(draftLimit);
    if (Number.isNaN(amount) || amount < 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/autonomy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAutonomousSpendUsd: amount }),
      });
      if (res.ok) {
        const data = await res.json();
        setBudget((prev) => ({ ...prev, maxAutonomousSpendUsd: data.maxAutonomousSpendUsd, remainingAutonomousUsd: Math.max(0, data.maxAutonomousSpendUsd - prev.totalSpentUsd) }));
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeAutonomyMode(mode: string) {
    setAutonomyMode(mode);
    await fetch("/api/settings/autonomy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomyMode: mode }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget & autonomy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="instrument instrument-sheen px-3 py-2.5">
            <p className="vox-headline text-xl">{formatUsd(budget.totalSpentUsd)}</p>
            <p className="vox-eyebrow mt-0.5">Total spent</p>
          </div>
          <div className="instrument instrument-sheen px-3 py-2.5">
            <p className="vox-headline text-xl">{formatUsd(budget.maxAutonomousSpendUsd)}</p>
            <p className="vox-eyebrow mt-0.5">Autonomous limit</p>
          </div>
          <div className="instrument instrument-sheen px-3 py-2.5">
            <p className="vox-headline text-xl">{formatUsd(budget.remainingAutonomousUsd)}</p>
            <p className="vox-eyebrow mt-0.5">Remaining headroom</p>
          </div>
        </div>
        <p className="text-xs text-muted">
          Any agent action that would spend more than this limit is refused by the economic.record_expense tool and
          requires human approval — this is a decision layer only, not connected to a real payment method.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="autonomous-limit">Autonomous spend limit (USD)</Label>
            <div className="flex gap-2">
              <Input id="autonomous-limit" type="number" min={0} value={draftLimit} onChange={(e) => setDraftLimit(e.target.value)} />
              <Button size="sm" onClick={saveLimit} disabled={saving}>
                Save
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="autonomy-mode">Autonomy mode</Label>
            <Select id="autonomy-mode" value={autonomyMode} onChange={(e) => changeAutonomyMode(e.target.value)}>
              <option value="MANUAL">Manual — VOX plans, you start execution</option>
              <option value="SUPERVISED">Supervised</option>
              <option value="AUTONOMOUS">Autonomous</option>
              <option value="AUTONOMOUS_APPROVAL_GATES">Autonomous with approval gates (recommended)</option>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
