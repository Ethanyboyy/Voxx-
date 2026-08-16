"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, ConfidenceTag } from "@/components/lab/primitives";

interface MaterialFields {
  densityGCm3: number;
  tensileStrengthMpa: number;
  elasticityPercent: number;
  abrasionResistance: number;
  temperatureResistanceC: number;
  moistureResistance: number;
  storageVolumeCm3: number;
  massG: number;
  confidence: string;
}

interface DeploymentFields {
  deploymentSpeedMs: number;
  lineLengthM: number;
  cartridgeSizeCm3: number;
  systemMassG: number;
  energyRequirementJ: number;
  deploymentReliabilityPct: number;
  confidence: string;
}

interface AttachmentFields {
  attachmentType: string;
  theoreticalHoldingStrengthN: number;
  environmentalAssumptions: string;
  geometry: string;
  structuralAssumptions: string;
  estimatedFailureProbabilityPct: number;
  confidence: string;
}

export interface WebProfileListItem {
  id: string;
  name: string;
  description: string | null;
  material: MaterialFields | null;
  deployment: DeploymentFields | null;
  attachment: AttachmentFields | null;
  loadModelCount: number;
}

const MATERIAL_FIELDS: { key: keyof Omit<MaterialFields, "confidence">; label: string; unit: string; default: number }[] = [
  { key: "densityGCm3", label: "Density", unit: "g/cm³", default: 1.15 },
  { key: "tensileStrengthMpa", label: "Tensile strength", unit: "MPa", default: 250 },
  { key: "elasticityPercent", label: "Elasticity", unit: "%", default: 40 },
  { key: "abrasionResistance", label: "Abrasion resistance", unit: "/100", default: 70 },
  { key: "temperatureResistanceC", label: "Temp. resistance", unit: "°C", default: 120 },
  { key: "moistureResistance", label: "Moisture resistance", unit: "/100", default: 60 },
  { key: "storageVolumeCm3", label: "Storage volume", unit: "cm³", default: 5 },
  { key: "massG", label: "Mass", unit: "g", default: 15 },
];

const DEPLOYMENT_FIELDS: { key: keyof Omit<DeploymentFields, "confidence">; label: string; unit: string; default: number }[] = [
  { key: "deploymentSpeedMs", label: "Deployment speed", unit: "m/s", default: 25 },
  { key: "lineLengthM", label: "Line length", unit: "m", default: 20 },
  { key: "cartridgeSizeCm3", label: "Cartridge size", unit: "cm³", default: 8 },
  { key: "systemMassG", label: "System mass", unit: "g", default: 120 },
  { key: "energyRequirementJ", label: "Energy requirement", unit: "J", default: 50 },
  { key: "deploymentReliabilityPct", label: "Deployment reliability", unit: "%", default: 90 },
];

export function WebLabClient({
  initialProfiles,
  projects,
}: {
  initialProfiles: WebProfileListItem[];
  projects: { id: string; name: string }[];
}) {
  const [profiles] = useState(initialProfiles);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const filtered = profiles.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search web systems…" className="max-w-xs" />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Web Profile"}
        </Button>
      </div>

      {showForm ? (
        <NewWebProfileForm
          projects={projects}
          onCreated={(profile) => {
            setShowForm(false);
            router.push(`/lab/web/${profile.id}`);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="No web systems found"
          description="Adjust your search, or start a new theoretical web-shooter profile."
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {filtered.length} web system{filtered.length === 1 ? "" : "s"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((p) => (
          <Link key={p.id} href={`/lab/web/${p.id}`}>
            <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{p.name}</p>
                  {p.description ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p> : null}
                </div>
                {p.material ? <ConfidenceTag confidence={p.material.confidence} /> : null}
              </div>
              {p.material && p.deployment ? (
                <div className="lab-mono mt-3 grid grid-cols-2 gap-1 text-[10px] text-muted">
                  <span>TENS {p.material.tensileStrengthMpa} MPa</span>
                  <span>REL {p.deployment.deploymentReliabilityPct}%</span>
                </div>
              ) : null}
              <p className="mt-2 text-[10px] text-muted-foreground">
                {p.loadModelCount} load model{p.loadModelCount === 1 ? "" : "s"}
              </p>
            </HolographicPanel>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NewWebProfileForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string }[];
  onCreated: (profile: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [material, setMaterial] = useState<Record<string, number>>(
    Object.fromEntries(MATERIAL_FIELDS.map((f) => [f.key, f.default]))
  );
  const [deployment, setDeployment] = useState<Record<string, number>>(
    Object.fromEntries(DEPLOYMENT_FIELDS.map((f) => [f.key, f.default]))
  );
  const [attachmentType, setAttachmentType] = useState("Wall/surface anchor");
  const [holdingStrengthN, setHoldingStrengthN] = useState(1200);
  const [environmentalAssumptions, setEnvironmentalAssumptions] = useState(
    "Dry, clean, non-porous vertical surface at room temperature."
  );
  const [geometry, setGeometry] = useState("Radial multi-strand splay, ~8cm contact diameter");
  const [structuralAssumptions, setStructuralAssumptions] = useState(
    "Anchor point assumed rigid; load applied along a single line axis."
  );
  const [failureProbabilityPct, setFailureProbabilityPct] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/web-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || undefined,
        projectId: projectId || undefined,
        material: { ...material, confidence: "HYPOTHETICAL" },
        deployment: { ...deployment, confidence: "HYPOTHETICAL" },
        attachment: {
          attachmentType,
          theoreticalHoldingStrengthN: holdingStrengthN,
          environmentalAssumptions,
          geometry,
          structuralAssumptions,
          estimatedFailureProbabilityPct: failureProbabilityPct,
          confidence: "HYPOTHETICAL",
        },
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.profile);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create web profile.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Line MK-I" />
        </div>
        {projects.length > 0 ? (
          <div>
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
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Design intent, notes…" />
        </div>
      </div>

      <LabSectionLabel className="mb-2 mt-4">Material</LabSectionLabel>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {MATERIAL_FIELDS.map((f) => (
          <div key={f.key}>
            <Label>
              {f.label} ({f.unit})
            </Label>
            <Input
              type="number"
              value={material[f.key]}
              onChange={(e) => setMaterial((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>

      <LabSectionLabel className="mb-2 mt-4">Deployment</LabSectionLabel>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {DEPLOYMENT_FIELDS.map((f) => (
          <div key={f.key}>
            <Label>
              {f.label} ({f.unit})
            </Label>
            <Input
              type="number"
              value={deployment[f.key]}
              onChange={(e) => setDeployment((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>

      <LabSectionLabel className="mb-2 mt-4">Attachment</LabSectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Attachment type</Label>
          <Input value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)} />
        </div>
        <div>
          <Label>Theoretical holding strength (N)</Label>
          <Input type="number" value={holdingStrengthN} onChange={(e) => setHoldingStrengthN(Number(e.target.value))} />
        </div>
        <div>
          <Label>Geometry</Label>
          <Input value={geometry} onChange={(e) => setGeometry(e.target.value)} />
        </div>
        <div>
          <Label>Estimated failure probability (%)</Label>
          <Input
            type="number"
            value={failureProbabilityPct}
            onChange={(e) => setFailureProbabilityPct(Number(e.target.value))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Environmental assumptions</Label>
          <Textarea value={environmentalAssumptions} onChange={(e) => setEnvironmentalAssumptions(e.target.value)} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Label>Structural assumptions</Label>
          <Textarea value={structuralAssumptions} onChange={(e) => setStructuralAssumptions(e.target.value)} rows={2} />
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating…" : "Create Web Profile"}
      </Button>
    </HolographicPanel>
  );
}
