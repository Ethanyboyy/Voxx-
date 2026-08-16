"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, StatBar, UnitStat, ConfidenceTag } from "@/components/lab/primitives";
import { HolographicModel, type SuitLayer } from "@/components/lab/HolographicModel";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";
import { HolographicInspectionTree, type InspectionNode } from "@/components/lab/HolographicInspectionTree";
import { useInfoMode } from "@/components/lab/InfoMode";

interface SuitStats {
  stealth: number;
  durability: number;
  mobility: number;
  stretchiness: number;
  weightKg: number;
  thermalLoadC: number;
  protection: number;
  environmentalResistance: number;
  manufacturingComplexity: number;
  estimatedBuildHours: number;
  estimatedCostUsd: number;
  flexibility: number;
  impactResistance: number;
  visibility: number;
  noiseProfile: number;
  sensorCapacity: number;
  energyRequirementW: number;
  maintenanceComplexity: number;
  confidence: string;
}

const CINEMATIC_KEYS = ["stealth", "durability", "mobility", "flexibility"] as const;
const CORE_KEYS = ["stealth", "durability", "mobility", "stretchiness", "protection", "environmentalResistance", "flexibility", "impactResistance", "visibility", "noiseProfile", "sensorCapacity", "manufacturingComplexity", "maintenanceComplexity"] as const;

const ALL_LAYERS: SuitLayer[] = ["outer", "structural", "thermal", "electronics", "sensors", "mask", "gloves", "boots"];

export function SuitDetailClient({
  suit,
  components,
  notes,
}: {
  suit: {
    id: string;
    codename: string;
    designation: string;
    archetype: string;
    description: string | null;
    status: string;
    colorPrimary: string;
    colorSecondary: string;
    silhouette: Silhouette;
    materialLanguage: MaterialLanguage;
    patternStyle: PatternStyle;
    armorLevel: ArmorLevel;
    maskLensStyle: MaskLensStyle;
    currentVersionLabel: string;
    stats: SuitStats;
    versions: { id: string; label: string; note: string | null; createdAt: string; isCurrent: boolean; stats: SuitStats | null }[];
  };
  components: InspectionNode[];
  notes: { id: string; content: string; createdAt: string }[];
}) {
  const { mode } = useInfoMode();
  const router = useRouter();
  const [layers, setLayers] = useState<Set<SuitLayer>>(new Set(ALL_LAYERS));
  const [noteText, setNoteText] = useState("");
  const [localNotes, setLocalNotes] = useState(notes);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleLayer(l: SuitLayer) {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }

  async function askAi(message: string) {
    setAiBusy(true);
    setAiReply(null);
    const res = await fetch("/api/lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    setAiReply(data.reply ?? "No response.");
    setAiBusy(false);
    if (data.action?.type === "view_suit") router.refresh();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const res = await fetch("/api/lab/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectType: "LabSuit", subjectId: suit.id, content: noteText }),
    });
    if (res.ok) {
      const data = await res.json();
      setLocalNotes((prev) => [{ id: data.note.id, content: data.note.content, createdAt: data.note.createdAt }, ...prev]);
      setNoteText("");
    }
  }

  async function duplicate() {
    const codename = prompt("New codename for the duplicate?", `${suit.codename} II`);
    if (!codename) return;
    setBusy(true);
    const res = await fetch(`/api/lab/suits/${suit.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newCodename: codename }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      router.push(`/lab/suits/${data.suit.id}`);
    }
  }

  async function toggleArchive() {
    setBusy(true);
    await fetch(`/api/lab/suits/${suit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: suit.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" }),
    });
    setBusy(false);
    router.refresh();
  }

  const keysToShow = mode === "CINEMATIC" ? CINEMATIC_KEYS : CORE_KEYS;

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{suit.codename}</h1>
            <LabStatusBadge status={suit.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {suit.designation} · {suit.archetype} · current {suit.currentVersionLabel}
          </p>
          {suit.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{suit.description}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={duplicate} disabled={busy}>
            Duplicate
          </Button>
          <Button size="sm" variant="secondary" onClick={toggleArchive} disabled={busy}>
            {suit.status === "ARCHIVED" ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => askAi(`Create a lighter variant of ${suit.codename}, optimized for mobility.`)} disabled={aiBusy}>
            Generate Lighter Variant
          </Button>
          <Button size="sm" onClick={() => askAi(`Analyze suit ${suit.codename} and list its strengths and weaknesses.`)} disabled={aiBusy}>
            {aiBusy ? "Analyzing…" : "Ask AI Engineer"}
          </Button>
        </div>
      </div>

      {aiReply ? (
        <HolographicPanel className="p-4 text-sm text-foreground">
          <LabSectionLabel>AI Lab Engineer</LabSectionLabel>
          <p className="mt-2 whitespace-pre-wrap">{aiReply}</p>
        </HolographicPanel>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <HolographicPanel corners scanline className="flex flex-col items-center p-5">
          <LabSectionLabel className="self-start">Holographic Model</LabSectionLabel>
          <HolographicModel
            colorPrimary={suit.colorPrimary}
            colorSecondary={suit.colorSecondary}
            silhouette={suit.silhouette}
            materialLanguage={suit.materialLanguage}
            patternStyle={suit.patternStyle}
            armorLevel={suit.armorLevel}
            maskLensStyle={suit.maskLensStyle}
            visibleLayers={layers}
            className="mt-3"
          />
          {mode !== "CINEMATIC" ? (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {ALL_LAYERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLayer(l)}
                  className={`lab-mono rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    layers.has(l) ? "border-[var(--border-strong)] bg-accent-muted text-accent" : "border-border text-muted-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          ) : null}
        </HolographicPanel>

        <div className="flex flex-col gap-4">
          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Statistics</LabSectionLabel>
              {mode === "EVERYTHING" ? <ConfidenceTag confidence={suit.stats.confidence} /> : null}
            </div>
            <div className="mt-3 space-y-2">
              {keysToShow.map((k) => (
                <StatBar key={k} statKey={k} value={(suit.stats as unknown as Record<string, number>)[k]} />
              ))}
            </div>
            {mode !== "CINEMATIC" ? (
              <div className="mt-4 grid grid-cols-2 gap-x-6 border-t border-border pt-3 sm:grid-cols-3">
                <UnitStat label="Weight" value={suit.stats.weightKg} unit="kg" />
                <UnitStat label="Thermal load" value={suit.stats.thermalLoadC} unit="°C" />
                <UnitStat label="Energy req." value={suit.stats.energyRequirementW} unit="W" />
                {mode === "EVERYTHING" ? (
                  <>
                    <UnitStat label="Build time" value={suit.stats.estimatedBuildHours} unit="hrs" />
                    <UnitStat label="Est. cost" value={suit.stats.estimatedCostUsd} unit="USD" />
                    <UnitStat label="Mfg. complexity" value={suit.stats.manufacturingComplexity} />
                  </>
                ) : null}
              </div>
            ) : null}
          </HolographicPanel>

          <HolographicPanel className="p-4">
            <LabSectionLabel>Component Inspection</LabSectionLabel>
            <div className="mt-3">
              <HolographicInspectionTree nodes={components} />
            </div>
          </HolographicPanel>

          {mode === "EVERYTHING" ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Version History</LabSectionLabel>
              <div className="mt-3 space-y-2">
                {suit.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className={v.isCurrent ? "font-semibold text-accent" : "text-foreground"}>{v.label}</span>
                      {v.note ? <span className="ml-2 text-xs text-muted">{v.note}</span> : null}
                    </div>
                    <span className="lab-mono text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </HolographicPanel>
          ) : null}

          <HolographicPanel className="p-4">
            <LabSectionLabel>Design Notes</LabSectionLabel>
            <div className="mt-3 flex gap-2">
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={1} placeholder="Add a note…" />
              <Button size="sm" onClick={addNote}>
                Add
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {localNotes.map((n) => (
                <div key={n.id} className="text-xs text-muted">
                  <span className="text-foreground">{n.content}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </HolographicPanel>
        </div>
      </div>
    </div>
  );
}
