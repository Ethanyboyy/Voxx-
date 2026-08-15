"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { HolographicPanel } from "@/components/lab/primitives";

const STAT_FIELDS: { key: string; label: string; unit?: string; default: number }[] = [
  { key: "massKg", label: "Mass", unit: "kg", default: 0.5 },
  { key: "powerRequirementW", label: "Power req.", unit: "W", default: 10 },
  { key: "batteryLifeHours", label: "Battery life", unit: "hrs", default: 4 },
  { key: "durability", label: "Durability", default: 50 },
  { key: "sensorAccuracy", label: "Sensor accuracy", default: 50 },
  { key: "rangeM", label: "Range", unit: "m", default: 20 },
  { key: "manufacturingComplexity", label: "Mfg. complexity", default: 50 },
  { key: "estimatedCostUsd", label: "Est. cost", unit: "USD", default: 2000 },
  { key: "reliability", label: "Reliability", default: 50 },
];

export function NewGadgetForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string }[];
  onCreated: (gadget: { id: string; name: string; category: string; status: string }) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Utility");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [stats, setStats] = useState<Record<string, number>>(
    Object.fromEntries(STAT_FIELDS.map((f) => [f.key, f.default]))
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
    const res = await fetch("/api/lab/gadgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category,
        description: description || undefined,
        projectId: projectId || undefined,
        stats: { ...stats, confidence: "HYPOTHETICAL" },
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.gadget);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create gadget.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Impact Webbing Launcher" />
        </div>
        <div>
          <Label>Category</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Utility", "Combat", "Recon", "Communication", "Mobility", "Sensor", "Experimental"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Design intent, notes…" />
        </div>
        {projects.length > 0 ? (
          <div className="sm:col-span-2">
            <Label>Project (optional)</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Initial stats (v0.1 — editable later as new versions)
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {STAT_FIELDS.map((f) => (
          <div key={f.key}>
            <Label>
              {f.label} {f.unit ? `(${f.unit})` : ""}
            </Label>
            <Input
              type="number"
              value={stats[f.key]}
              onChange={(e) => setStats((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating…" : "Create Gadget"}
      </Button>
    </HolographicPanel>
  );
}
