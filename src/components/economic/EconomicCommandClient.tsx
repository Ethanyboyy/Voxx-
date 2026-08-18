"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface AssetItem {
  id: string;
  opportunityId: string | null;
  name: string;
  category: string;
  status: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Overview {
  assetCount: number;
  operatingCount: number;
  totalRevenueUsd: number;
  totalExpenseUsd: number;
  profitUsd: number;
}

const CATEGORIES = [
  "MICRO_SAAS",
  "DIGITAL_PRODUCT",
  "CONTENT_ASSET",
  "WEBSITE",
  "AFFILIATE_ASSET",
  "LEAD_GENERATION",
  "API_PRODUCT",
  "AUTOMATION_SERVICE",
  "LICENSED_SOFTWARE",
  "OTHER",
] as const;

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  IDEA: "neutral",
  BUILDING: "accent",
  LAUNCHED: "accent",
  OPERATING: "success",
  PAUSED: "warning",
  RETIRED: "danger",
};

function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel px-3 py-2.5">
      <p className="vox-headline text-xl">{value}</p>
      <p className="vox-eyebrow mt-0.5">{label}</p>
    </div>
  );
}

export function EconomicCommandClient({
  initialAssets,
  overview,
  opportunities,
}: {
  initialAssets: AssetItem[];
  overview: Overview;
  opportunities: { id: string; title: string }[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Assets" value={String(overview.assetCount)} />
        <StatTile label="Operating" value={String(overview.operatingCount)} />
        <StatTile label="Revenue" value={formatUsd(overview.totalRevenueUsd)} />
        <StatTile label="Expenses" value={formatUsd(overview.totalExpenseUsd)} />
        <StatTile label="Profit" value={formatUsd(overview.profitUsd)} />
      </div>

      <div className="flex items-center justify-between">
        <p className="vox-eyebrow">Assets</p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Asset"}
        </Button>
      </div>

      {showForm ? (
        <NewAssetForm
          opportunities={opportunities}
          onCreated={(asset) => {
            setAssets((prev) => [asset, ...prev]);
            setShowForm(false);
            router.refresh();
          }}
        />
      ) : null}

      {assets.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Promote a real Opportunity (Objectives) into an asset here once you actually start building it — nothing is invented in the meantime."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {assets.map((a) => (
            <Link key={a.id} href={`/finance/${a.id}`}>
              <Card className="vox-lift h-full p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{a.name}</p>
                  <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.category.replace(/_/g, " ").toLowerCase()}</p>
                {a.description ? <p className="mt-2 line-clamp-2 text-xs text-muted">{a.description}</p> : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAssetForm({
  opportunities,
  onCreated,
}: {
  opportunities: { id: string; title: string }[];
  onCreated: (asset: AssetItem) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("MICRO_SAAS");
  const [opportunityId, setOpportunityId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/economic/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category,
        opportunityId: opportunityId || undefined,
        description: description || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.asset);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create asset.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Economic Asset</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VOX API access" />
        </div>
        <div>
          <Label>Category</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        {opportunities.length > 0 ? (
          <div className="sm:col-span-2">
            <Label>Built from opportunity (optional)</Label>
            <Select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">None</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this?" />
        </div>
        {error ? <p className="text-sm text-danger sm:col-span-2">{error}</p> : null}
        <Button className="sm:col-span-2" onClick={handleSubmit} disabled={busy}>
          {busy ? "Creating…" : "Create Asset"}
        </Button>
      </CardContent>
    </Card>
  );
}
