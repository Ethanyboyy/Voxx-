"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils/cn";
import { HolographicPanel, LabSectionLabel, RealityStatusTag, StatBar, UnitStat } from "@/components/lab/primitives";
import type { InspectionNode } from "@/components/lab/HolographicInspectionTree";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";
import type { SuitLayer } from "@/components/lab/three/SuitRig";

const HolographicSuitCanvas = dynamic(
  () => import("@/components/lab/three/HolographicSuitCanvas").then((m) => m.HolographicSuitCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="lab-mono text-xs text-muted-foreground">Initializing hologram…</div>
      </div>
    ),
  }
);

const ALL_LAYERS: SuitLayer[] = ["outer", "structural", "thermal", "electronics", "sensors", "mask", "gloves", "boots"];
// "Blueprint" hides the outer shell/mask/extremities so the internal
// structural/electronics/sensor layers read as a real skeleton view — an
// actual distinct render, not a decorative fourth button beside the other
// three that does nothing.
const BLUEPRINT_LAYERS: SuitLayer[] = ["structural", "electronics", "sensors"];

type ViewMode = "3D" | "MATERIALS" | "BLUEPRINT" | "ANIMATION";
const VIEW_MODE_LABEL: Record<ViewMode, string> = { "3D": "3D View", MATERIALS: "Materials", BLUEPRINT: "Blueprint", ANIMATION: "Animation" };

interface SuitStats {
  stealth: number;
  durability: number;
  mobility: number;
  stretchiness: number;
  weightKg: number;
  thermalLoadC: number;
  flexibility: number;
  impactResistance: number;
  estimatedBuildHours: number;
  energyRequirementW: number;
}

export interface SuitOverviewPanelProps {
  suit: {
    designation: string;
    archetype: string;
    realityStatus: string;
    description: string | null;
    modelUrl: string | null;
    colorPrimary: string;
    colorSecondary: string;
    silhouette: Silhouette;
    materialLanguage: MaterialLanguage;
    patternStyle: PatternStyle;
    armorLevel: ArmorLevel;
    maskLensStyle: MaskLensStyle;
    stats: SuitStats;
  };
  components: InspectionNode[];
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="lab-mono text-foreground">{value}</span>
    </div>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <LabSectionLabel className="mb-1.5">{label}</LabSectionLabel>
      {items.length === 0 ? (
        <p className="text-xs text-muted">Not recorded yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span key={item} className="lab-mono rounded-full border border-border px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The suit's real "at a glance" overview — hero hologram, identity/spec
 * summary, real component-derived materials/systems, initial stats, and
 * additional metrics — all in one flowing card rather than split across a
 * separate model panel and a separate statistics panel. Every field here
 * is a real, already-recorded value (SuitStats, the component tree's own
 * materialName/name, colorPrimary/colorSecondary) — nothing invented.
 */
export function SuitOverviewPanel({ suit, components }: SuitOverviewPanelProps) {
  const [mode, setMode] = useState<ViewMode>("3D");
  const xray = mode === "MATERIALS";
  const autoRotate = mode === "ANIMATION";
  const visibleLayers = mode === "BLUEPRINT" ? new Set(BLUEPRINT_LAYERS) : new Set(ALL_LAYERS);

  const materials = [...new Set(components.map((c) => c.materialName).filter((v): v is string => Boolean(v)))];
  const systems = [...new Set(components.map((c) => c.name))];

  return (
    <HolographicPanel corners scanline className="flex flex-col gap-5 p-5">
      <LabSectionLabel>Suit Overview</LabSectionLabel>

      <div className="flex justify-center">
        <div className="lab-hologram touch-none select-none" style={{ width: 380, height: 380 }}>
          <HolographicSuitCanvas
            colorPrimary={suit.colorPrimary}
            colorSecondary={suit.colorSecondary}
            silhouette={suit.silhouette}
            materialLanguage={suit.materialLanguage}
            patternStyle={suit.patternStyle}
            armorLevel={suit.armorLevel}
            maskLensStyle={suit.maskLensStyle}
            modelUrl={suit.modelUrl}
            visibleLayers={visibleLayers}
            xray={xray}
            explodeAmount={0}
            autoRotate={autoRotate}
            showEffects
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <InfoRow label="Suit ID" value={suit.designation} />
          <InfoRow label="Class" value={suit.archetype} />
          <InfoRow label="Status" value={<RealityStatusTag status={suit.realityStatus} />} />
          <InfoRow label="Weight" value={`${suit.stats.weightKg} kg`} />
          <InfoRow label="Temperature" value={`${suit.stats.thermalLoadC}°C`} />

          <div className="mt-1">
            <LabSectionLabel className="mb-1.5">View Modes</LabSectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(VIEW_MODE_LABEL) as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "lab-mono rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors",
                    mode === m ? "border-[var(--border-strong)] bg-accent-muted text-accent" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {VIEW_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <ChipGroup label="Materials" items={materials} />
          <ChipGroup label="Systems" items={systems} />
          <div>
            <LabSectionLabel className="mb-1.5">Suit Color</LabSectionLabel>
            <div className="flex gap-2">
              <span className="h-6 w-6 rounded-full border border-border" style={{ background: suit.colorPrimary }} title="Primary" />
              <span className="h-6 w-6 rounded-full border border-border" style={{ background: suit.colorSecondary }} title="Secondary" />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <LabSectionLabel className="mb-2">Initial Stats</LabSectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <StatBar statKey="stealth" value={suit.stats.stealth} />
          <StatBar statKey="durability" value={suit.stats.durability} />
          <StatBar statKey="mobility" value={suit.stats.mobility} />
          <StatBar statKey="stretchiness" value={suit.stats.stretchiness} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border pt-4 sm:grid-cols-3">
        <UnitStat label="Weight" value={suit.stats.weightKg} unit="kg" />
        <UnitStat label="Heat output" value={suit.stats.thermalLoadC} unit="°C" />
        <UnitStat label="Time to build" value={suit.stats.estimatedBuildHours} unit="hrs" />
        <UnitStat label="Flexibility" value={suit.stats.flexibility} />
        <UnitStat label="Impact resist." value={suit.stats.impactResistance} />
        <UnitStat label="Power draw" value={suit.stats.energyRequirementW} unit="W" />
      </div>

      {suit.description ? (
        <div className="border-t border-border pt-4">
          <LabSectionLabel className="mb-1.5">Description</LabSectionLabel>
          <p className="text-sm text-muted">{suit.description}</p>
        </div>
      ) : null}
    </HolographicPanel>
  );
}
