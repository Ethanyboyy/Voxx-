"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface LedgerEntry {
  id: string;
  amountUsd: number;
  source?: string | null;
  category?: string | null;
  occurredAt: string;
  notes: string | null;
}

interface AssetDetail {
  id: string;
  name: string;
  category: string;
  status: string;
  description: string | null;
  totals: { totalRevenueUsd: number; totalExpenseUsd: number; profitUsd: number };
  revenues: LedgerEntry[];
  expenses: LedgerEntry[];
}

function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function EconomicAssetDetailClient({ asset: initial }: { asset: AssetDetail }) {
  const [asset, setAsset] = useState(initial);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="vox-eyebrow">Economic Command</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="vox-headline text-2xl">{asset.name}</h1>
          <Badge tone="neutral">{asset.status.toLowerCase()}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">{asset.category.replace(/_/g, " ").toLowerCase()}</p>
        {asset.description ? <p className="mt-2 text-sm text-muted">{asset.description}</p> : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="glass-panel px-3 py-2.5">
          <p className="vox-headline text-lg text-success">{formatUsd(asset.totals.totalRevenueUsd)}</p>
          <p className="vox-eyebrow mt-0.5">Revenue</p>
        </div>
        <div className="glass-panel px-3 py-2.5">
          <p className="vox-headline text-lg text-danger">{formatUsd(asset.totals.totalExpenseUsd)}</p>
          <p className="vox-eyebrow mt-0.5">Expenses</p>
        </div>
        <div className="glass-panel px-3 py-2.5">
          <p className="vox-headline text-lg">{formatUsd(asset.totals.profitUsd)}</p>
          <p className="vox-eyebrow mt-0.5">Profit</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <LedgerSection
          title="Revenue"
          entries={asset.revenues}
          fieldLabel="Source"
          onAdd={async (input) => {
            const res = await fetch(`/api/economic/assets/${asset.id}/revenue`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ amountUsd: input.amount, source: input.label || undefined, occurredAt: input.date }),
            });
            if (res.ok) {
              const data = await res.json();
              setAsset((prev) => ({
                ...prev,
                revenues: [data.revenue, ...prev.revenues],
                totals: { ...prev.totals, totalRevenueUsd: prev.totals.totalRevenueUsd + data.revenue.amountUsd, profitUsd: prev.totals.profitUsd + data.revenue.amountUsd },
              }));
              router.refresh();
            }
          }}
        />
        <LedgerSection
          title="Expenses"
          entries={asset.expenses}
          fieldLabel="Category"
          onAdd={async (input) => {
            const res = await fetch(`/api/economic/assets/${asset.id}/expenses`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ amountUsd: input.amount, category: input.label || undefined, occurredAt: input.date }),
            });
            if (res.ok) {
              const data = await res.json();
              setAsset((prev) => ({
                ...prev,
                expenses: [data.expense, ...prev.expenses],
                totals: { ...prev.totals, totalExpenseUsd: prev.totals.totalExpenseUsd + data.expense.amountUsd, profitUsd: prev.totals.profitUsd - data.expense.amountUsd },
              }));
              router.refresh();
            }
          }}
        />
      </div>
    </div>
  );
}

function LedgerSection({
  title,
  entries,
  fieldLabel,
  onAdd,
}: {
  title: string;
  entries: LedgerEntry[];
  fieldLabel: string;
  onAdd: (input: { amount: number; label: string; date: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setBusy(true);
    await onAdd({ amount: parsed, label, date: new Date(date).toISOString() });
    setBusy(false);
    setAmount("");
    setLabel("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {entries.length === 0 ? (
            <EmptyState title={`No ${title.toLowerCase()} logged yet`} description="Add a real entry below." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-[var(--radius-xs)] border border-border px-2.5 py-1.5 text-sm">
                  <div>
                    <span className="text-foreground">{formatUsd(e.amountUsd)}</span>
                    {e.source || e.category ? <span className="ml-2 text-xs text-muted-foreground">{e.source ?? e.category}</span> : null}
                  </div>
                  <span className="lab-mono text-[10px] text-muted-foreground">{new Date(e.occurredAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-3">
            <div>
              <Label>Amount (USD)</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>{fieldLabel}</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
            </div>
            <Button className="col-span-2" size="sm" onClick={submit} disabled={busy}>
              {busy ? "Adding…" : `Add ${title === "Revenue" ? "revenue" : "expense"}`}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
