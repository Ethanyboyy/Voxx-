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
            {filtered.length} material{filtered.length === 1 ? "" : "s"}
          </p>
          <HolographicPanel className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="lab-mono border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 text-right font-semibold">Density</th>
                  <th className="px-3 py-2 text-right font-semibold">Tensile</th>
                  <th className="px-3 py-2 text-right font-semibold">Elasticity</th>
                  <th className="px-3 py-2 text-right font-semibold">Abrasion</th>
                  <th className="px-3 py-2 text-right font-semibold">Temp. res.</th>
                  <th className="px-3 py-2 text-right font-semibold">Moisture</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost/kg</th>
                  <th className="px-3 py-2 font-semibold">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 last:border-0 hover:bg-surface-hover">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {m.name}
                      {m.isCustom ? <span className="ml-1.5 text-[10px] text-accent">custom</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{m.category}</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.densityGCm3} g/cm³</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.tensileStrengthMpa} MPa</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.elasticityPercent}%</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.abrasionResistance}</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.temperatureResistanceC}°C</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">{m.moistureResistance}</td>
                    <td className="lab-mono px-3 py-2 text-right text-foreground">${m.costPerKgUsd}</td>
                    <td className="px-3 py-2">
                      <ConfidenceTag confidence={m.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HolographicPanel>
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
    <HolographicPanel corners className="p-4">
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

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Properties</p>
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
