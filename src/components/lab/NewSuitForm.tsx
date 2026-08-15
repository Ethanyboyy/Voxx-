"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { HolographicPanel } from "@/components/lab/primitives";

const STAT_FIELDS: { key: string; label: string; unit?: string; default: number }[] = [
  { key: "stealth", label: "Stealth", default: 50 },
  { key: "durability", label: "Durability", default: 50 },
  { key: "mobility", label: "Mobility", default: 50 },
  { key: "stretchiness", label: "Stretchiness", default: 50 },
  { key: "weightKg", label: "Weight", unit: "kg", default: 4.5 },
  { key: "thermalLoadC", label: "Thermal load", unit: "°C", default: 32 },
  { key: "protection", label: "Protection", default: 50 },
  { key: "environmentalResistance", label: "Env. resistance", default: 50 },
  { key: "manufacturingComplexity", label: "Mfg. complexity", default: 50 },
  { key: "estimatedBuildHours", label: "Build time", unit: "hrs", default: 120 },
  { key: "estimatedCostUsd", label: "Est. cost", unit: "USD", default: 25000 },
  { key: "flexibility", label: "Flexibility", default: 50 },
  { key: "impactResistance", label: "Impact resistance", default: 50 },
  { key: "visibility", label: "Visibility", default: 40 },
  { key: "noiseProfile", label: "Noise profile", default: 30 },
  { key: "sensorCapacity", label: "Sensor capacity", default: 40 },
  { key: "energyRequirementW", label: "Energy req.", unit: "W", default: 25 },
  { key: "maintenanceComplexity", label: "Maintenance", default: 40 },
];

export function NewSuitForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string }[];
  onCreated: (suit: { id: string; codename: string; designation: string; archetype: string; status: string; colorPrimary: string; colorSecondary: string }) => void;
}) {
  const [codename, setCodename] = useState("");
  const [archetype, setArchetype] = useState("Stealth");
  const [description, setDescription] = useState("");
  const [colorPrimary, setColorPrimary] = useState("#a855f7");
  const [colorSecondary, setColorSecondary] = useState("#0a0616");
  const [projectId, setProjectId] = useState("");
  const [stats, setStats] = useState<Record<string, number>>(
    Object.fromEntries(STAT_FIELDS.map((f) => [f.key, f.default]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!codename.trim()) {
      setError("Codename is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/suits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codename,
        archetype,
        description: description || undefined,
        colorPrimary,
        colorSecondary,
        projectId: projectId || undefined,
        stats: { ...stats, confidence: "HYPOTHETICAL" },
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.suit);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create suit.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Codename</Label>
          <Input value={codename} onChange={(e) => setCodename(e.target.value)} placeholder="e.g. Nightcrawler" />
        </div>
        <div>
          <Label>Archetype</Label>
          <Select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            {["Stealth", "Combat", "Recon", "Utility", "Experimental", "Aerial", "Urban"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Design intent, notes…" />
        </div>
        <div>
          <Label>Primary color</Label>
          <input type="color" value={colorPrimary} onChange={(e) => setColorPrimary(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface" />
        </div>
        <div>
          <Label>Secondary color</Label>
          <input type="color" value={colorSecondary} onChange={(e) => setColorSecondary(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface" />
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
        {busy ? "Creating…" : "Create Suit"}
      </Button>
    </HolographicPanel>
  );
}
