"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, ConfidenceTag } from "@/components/lab/primitives";

interface Material {
  id: string;
  name: string;
  category: string;
  densityGCm3: number;
  tensileStrengthMpa: number;
  elasticityPercent: number;
  abrasionResistance: number;
  temperatureResistanceC: number;
  moistureResistance: number;
  costPerKgUsd: number;
  notes: string | null;
  confidence: string;
  isCustom: boolean;
}

const NUMERIC_FIELDS: { key: keyof Material; label: string; unit?: string; default: number }[] = [
  { key: "densityGCm3", label: "Density", unit: "g/cm³", default: 1.2 },
  { key: "tensileStrengthMpa", label: "Tensile strength", unit: "MPa", default: 100 },
  { key: "elasticityPercent", label: "Elasticity", unit: "%", default: 20 },
  { key: "abrasionResistance", label: "Abrasion resistance", default: 50 },
  { key: "temperatureResistanceC", label: "Temp. resistance", unit: "°C", default: 100 },
  { key: "moistureResistance", label: "Moisture resistance", default: 50 },
  { key: "costPerKgUsd", label: "Cost per kg", unit: "USD", default: 25 },
];

/** A single material property rendered as a compact bar, scaled against the
 * max value in the currently visible (filtered) set — reads as an engineering
 * comparison rather than an isolated number. */
function PropertyBar({
  label,
  value,
  max,
  unit,
  decimals = 0,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  decimals?: number;
}) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="lab-mono w-20 shrink-0 text-right text-[10px] text-foreground">
        {value.toFixed(decimals)}
        {unit ? <span className="ml-0.5 text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

export function MaterialsClient({ initialMaterials }: { initialMaterials: Material[] }) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const categories = useMemo(() => Array.from(new Set(materials.map((m) => m.category))).sort(), [materials]);

  const filtered = materials.filter((m) => {
    if (category !== "all" && m.category !== category) return false;
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of filtered) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const maxTensile = Math.max(1, ...filtered.map((m) => m.tensileStrengthMpa));
  const maxDensity = Math.max(1, ...filtered.map((m) => m.densityGCm3));
  const maxCost = Math.max(1, ...filtered.map((m) => m.costPerKgUsd));

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search materials…"
          className="max-w-xs"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="max-w-[180px]">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add Material"}
        </Button>
      </div>

      {showForm ? (
        <AddMaterialForm
          onCreated={(material) => {
            setMaterials((prev) => [{ ...material, isCustom: true }, ...prev]);
            setShowForm(false);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No materials found" description="Adjust your filters, or add a new material." />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {filtered.length} material{filtered.length === 1 ? "" : "s"} across {grouped.length} categor
            {grouped.length === 1 ? "y" : "ies"}
          </p>
          <div className="flex flex-col gap-5">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <div className="flex items-center justify-between">
                  <LabSectionLabel>{cat}</LabSectionLabel>
                  <span className="lab-mono text-[10px] text-muted-foreground">
                    {items.length} material{items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <HolographicPanel corners className="mt-2 overflow-hidden p-0">
                  <div className="divide-y divide-border/60">
                    {items.map((m) => (
                      <div key={m.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold text-foreground">{m.name}</p>
                            {m.isCustom ? (
                              <span className="lab-mono shrink-0 rounded-full border border-[var(--border-strong)] bg-accent-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                                Custom
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <ConfidenceTag confidence={m.confidence} />
                            <span className="lab-mono text-[10px] text-muted-foreground">
                              elast {m.elasticityPercent}% · abr {m.abrasionResistance} · {m.temperatureResistanceC}°C · moist{" "}
                              {m.moistureResistance}
                            </span>
                          </div>
                          {m.notes ? <p className="mt-1.5 line-clamp-2 text-xs text-muted">{m.notes}</p> : null}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <PropertyBar label="Tensile" value={m.tensileStrengthMpa} max={maxTensile} unit=" MPa" />
                          <PropertyBar label="Density" value={m.densityGCm3} max={maxDensity} unit=" g/cm³" decimals={2} />
                          <PropertyBar label="Cost/kg" value={m.costPerKgUsd} max={maxCost} unit=" USD" />
                        </div>
                      </div>
                    ))}
                  </div>
                </HolographicPanel>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AddMaterialForm({ onCreated }: { onCreated: (material: Omit<Material, "isCustom">) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Polymer");
  const [notes, setNotes] = useState("");
  const [confidence, setConfidence] = useState("ESTIMATED");
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, f.default]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category,
        notes: notes || undefined,
        confidence,
        ...values,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.material);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to add material.");
    }
  }

  return (
    <HolographicPanel corners scanline className="p-4">
      <LabSectionLabel>New Material</LabSectionLabel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Carbon Nanotube Weave" />
        </div>
        <div>
          <Label>Category</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Polymer", "Metal", "Composite", "Fabric", "Ceramic", "Elastomer", "Biomaterial"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Source, properties, caveats…" />
        </div>
        <div>
          <Label>Confidence</Label>
          <Select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {["VERIFIED", "ESTIMATED", "HYPOTHETICAL", "UNKNOWN"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <LabSectionLabel className="mb-2 mt-4">Properties</LabSectionLabel>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {NUMERIC_FIELDS.map((f) => (
          <div key={f.key}>
            <Label>
              {f.label} {f.unit ? `(${f.unit})` : ""}
            </Label>
            <Input
              type="number"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Adding…" : "Add Material"}
      </Button>
    </HolographicPanel>
  );
}
