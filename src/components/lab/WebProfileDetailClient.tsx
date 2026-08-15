"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HolographicPanel,
  LabSectionLabel,
  UnitStat,
  ConfidenceTag,
  SafetyNotice,
} from "@/components/lab/primitives";
import { useInfoMode } from "@/components/lab/InfoMode";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

interface Material {
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

interface Deployment {
  deploymentSpeedMs: number;
  lineLengthM: number;
  cartridgeSizeCm3: number;
  systemMassG: number;
  energyRequirementJ: number;
  deploymentReliabilityPct: number;
  confidence: string;
}

interface Attachment {
  attachmentType: string;
  theoreticalHoldingStrengthN: number;
  environmentalAssumptions: string;
  geometry: string;
  structuralAssumptions: string;
  estimatedFailureProbabilityPct: number;
  confidence: string;
}

interface LoadModel {
  id: string;
  label: string;
  userMassKg: number;
  equipmentMassKg: number;
  swingRadiusM: number;
  velocityMs: number;
  staticLoadN: number;
  dynamicLoadN: number;
  accelerationMs2: number;
  forceN: number;
  tensionN: number;
  safetyMarginPct: number;
  confidence: string;
  createdAt: string;
}

const SAFETY_TEXT =
  "Theoretical model output only — not a real-world engineering or safety validation. Independent professional testing would be required before any human load-bearing use.";

export function WebProfileDetailClient({
  profile,
}: {
  profile: {
    id: string;
    name: string;
    description: string | null;
    material: Material;
    deployment: Deployment;
    attachment: Attachment;
    loadModels: LoadModel[];
  };
}) {
  const { mode } = useInfoMode();
  const [loadModels, setLoadModels] = useState(profile.loadModels);

  const [label, setLabel] = useState("Standard swing");
  const [userMassKg, setUserMassKg] = useState(75);
  const [equipmentMassKg, setEquipmentMassKg] = useState(5);
  const [swingRadiusM, setSwingRadiusM] = useState(12);
  const [velocityMs, setVelocityMs] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LoadModel | null>(loadModels[0] ?? null);

  const showBreakdown = mode !== "CINEMATIC";

  async function runLoadModel() {
    if (!label.trim()) {
      setError("Scenario label is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/lab/web-profiles/${profile.id}/load-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, userMassKg, equipmentMassKg, swingRadiusM, velocityMs }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setLoadModels((prev) => [data.model, ...prev]);
      setLastResult(data.model);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to compute load model.");
    }
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/lab/web" className="text-xs text-muted-foreground hover:text-foreground">
              ← Web Lab
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{profile.name}</h1>
          {profile.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{profile.description}</p> : null}
        </div>
      </div>

      <SafetyNotice>
        This Web Lab module models a fictional web-shooter system theoretically. {SAFETY_TEXT}
      </SafetyNotice>

      {!showBreakdown ? (
        <HolographicPanel className="p-4">
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            <UnitStat label="Tensile strength" value={profile.material.tensileStrengthMpa} unit="MPa" />
            <UnitStat label="Deployment reliability" value={profile.deployment.deploymentReliabilityPct} unit="%" />
            <UnitStat label="Holding strength" value={profile.attachment.theoreticalHoldingStrengthN} unit="N" />
          </div>
        </HolographicPanel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Material</LabSectionLabel>
              <ConfidenceTag confidence={profile.material.confidence} />
            </div>
            <div className="mt-3">
              <UnitStat label="Density" value={profile.material.densityGCm3} unit="g/cm³" />
              <UnitStat label="Tensile strength" value={profile.material.tensileStrengthMpa} unit="MPa" />
              <UnitStat label="Elasticity" value={profile.material.elasticityPercent} unit="%" />
              <UnitStat label="Abrasion resistance" value={profile.material.abrasionResistance} unit="/100" />
              <UnitStat label="Temp. resistance" value={profile.material.temperatureResistanceC} unit="°C" />
              <UnitStat label="Moisture resistance" value={profile.material.moistureResistance} unit="/100" />
              <UnitStat label="Storage volume" value={profile.material.storageVolumeCm3} unit="cm³" />
              <UnitStat label="Mass" value={profile.material.massG} unit="g" />
            </div>
          </HolographicPanel>

          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Deployment</LabSectionLabel>
              <ConfidenceTag confidence={profile.deployment.confidence} />
            </div>
            <div className="mt-3">
              <UnitStat label="Deployment speed" value={profile.deployment.deploymentSpeedMs} unit="m/s" />
              <UnitStat label="Line length" value={profile.deployment.lineLengthM} unit="m" />
              <UnitStat label="Cartridge size" value={profile.deployment.cartridgeSizeCm3} unit="cm³" />
              <UnitStat label="System mass" value={profile.deployment.systemMassG} unit="g" />
              <UnitStat label="Energy requirement" value={profile.deployment.energyRequirementJ} unit="J" />
              <UnitStat label="Deployment reliability" value={profile.deployment.deploymentReliabilityPct} unit="%" />
            </div>
          </HolographicPanel>

          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Attachment</LabSectionLabel>
              <ConfidenceTag confidence={profile.attachment.confidence} />
            </div>
            <div className="mt-3">
              <UnitStat label="Type" value={profile.attachment.attachmentType} />
              <UnitStat label="Theoretical holding strength" value={profile.attachment.theoreticalHoldingStrengthN} unit="N" />
              <UnitStat label="Est. failure probability" value={profile.attachment.estimatedFailureProbabilityPct} unit="%" />
              {mode === "EVERYTHING" ? (
                <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs text-muted">
                  <p>
                    <span className="text-muted-foreground">Geometry: </span>
                    {profile.attachment.geometry}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Environmental assumptions: </span>
                    {profile.attachment.environmentalAssumptions}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Structural assumptions: </span>
                    {profile.attachment.structuralAssumptions}
                  </p>
                </div>
              ) : null}
            </div>
          </HolographicPanel>
        </div>
      )}

      <HolographicPanel corners className="p-4">
        <LabSectionLabel>Load Model Calculator</LabSectionLabel>
        <p className="mt-1 text-xs text-muted-foreground">
          Computes a theoretical static/dynamic swing load from mass, radius, and velocity (F = ma, centripetal).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="sm:col-span-1">
            <Label>Scenario label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>User mass (kg)</Label>
            <Input type="number" value={userMassKg} onChange={(e) => setUserMassKg(Number(e.target.value))} />
          </div>
          <div>
            <Label>Equipment mass (kg)</Label>
            <Input type="number" value={equipmentMassKg} onChange={(e) => setEquipmentMassKg(Number(e.target.value))} />
          </div>
          <div>
            <Label>Swing radius (m)</Label>
            <Input type="number" value={swingRadiusM} onChange={(e) => setSwingRadiusM(Number(e.target.value))} />
          </div>
          <div>
            <Label>Velocity (m/s)</Label>
            <Input type="number" value={velocityMs} onChange={(e) => setVelocityMs(Number(e.target.value))} />
          </div>
        </div>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <Button className="mt-3" size="sm" onClick={runLoadModel} disabled={busy}>
          {busy ? "Computing…" : "Run Load Model"}
        </Button>

        {lastResult ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Result — {lastResult.label}</LabSectionLabel>
              <ConfidenceTag confidence={lastResult.confidence} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <UnitStat label="Static load" value={lastResult.staticLoadN} unit="N" />
              <UnitStat label="Dynamic load" value={lastResult.dynamicLoadN} unit="N" />
              <UnitStat label="Acceleration" value={lastResult.accelerationMs2} unit="m/s²" />
              <UnitStat label="Force" value={lastResult.forceN} unit="N" />
              <UnitStat label="Line tension" value={lastResult.tensionN} unit="N" />
              <UnitStat label="Safety margin" value={lastResult.safetyMarginPct} unit="%" />
            </div>
            <SafetyNotice>{SAFETY_TEXT}</SafetyNotice>
          </div>
        ) : null}
      </HolographicPanel>

      <HolographicPanel className="p-4">
        <LabSectionLabel>Past Load Models</LabSectionLabel>
        {loadModels.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No load models computed yet — run the calculator above.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {loadModels.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-hover">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{m.label}</span>
                  <ConfidenceTag confidence={m.confidence} />
                </div>
                <div className="lab-mono flex flex-wrap gap-3 text-muted">
                  <span>tension {m.tensionN} N</span>
                  <span>force {m.forceN} N</span>
                  <span>margin {m.safetyMarginPct}%</span>
                </div>
                <span className="lab-mono text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </HolographicPanel>
    </div>
  );
}
