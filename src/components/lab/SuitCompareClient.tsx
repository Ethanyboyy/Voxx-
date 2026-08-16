"use client";

import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { HolographicModel } from "@/components/lab/HolographicModel";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";

interface CompareStats {
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
}

const ROWS: { key: keyof CompareStats; label: string; unit?: string; lowerIsBetter?: boolean }[] = [
  { key: "stealth", label: "Stealth" },
  { key: "durability", label: "Durability" },
  { key: "mobility", label: "Mobility" },
  { key: "stretchiness", label: "Stretchiness" },
  { key: "weightKg", label: "Weight", unit: "kg", lowerIsBetter: true },
  { key: "thermalLoadC", label: "Thermal load", unit: "°C", lowerIsBetter: true },
  { key: "protection", label: "Protection" },
  { key: "environmentalResistance", label: "Env. resistance" },
  { key: "manufacturingComplexity", label: "Mfg. complexity", lowerIsBetter: true },
  { key: "estimatedBuildHours", label: "Build time", unit: "hrs", lowerIsBetter: true },
  { key: "estimatedCostUsd", label: "Est. cost", unit: "USD", lowerIsBetter: true },
  { key: "flexibility", label: "Flexibility" },
  { key: "impactResistance", label: "Impact resistance" },
  { key: "visibility", label: "Visibility", lowerIsBetter: true },
  { key: "noiseProfile", label: "Noise profile", lowerIsBetter: true },
  { key: "sensorCapacity", label: "Sensor capacity" },
  { key: "energyRequirementW", label: "Energy req.", unit: "W", lowerIsBetter: true },
  { key: "maintenanceComplexity", label: "Maintenance", lowerIsBetter: true },
];

export function SuitCompareClient({
  suits,
}: {
  suits: {
    id: string;
    codename: string;
    archetype: string;
    colorPrimary: string;
    colorSecondary: string;
    silhouette: Silhouette;
    materialLanguage: MaterialLanguage;
    patternStyle: PatternStyle;
    armorLevel: ArmorLevel;
    maskLensStyle: MaskLensStyle;
    componentCount: number;
    stats: CompareStats;
  }[];
}) {
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${suits.length}, minmax(0, 1fr))` }}>
        {suits.map((s) => (
          <HolographicPanel key={s.id} corners className="flex flex-col items-center p-4">
            <p className="font-semibold text-foreground">{s.codename}</p>
            <p className="text-xs text-muted-foreground">{s.archetype}</p>
            <HolographicModel
              colorPrimary={s.colorPrimary}
              colorSecondary={s.colorSecondary}
              silhouette={s.silhouette}
              materialLanguage={s.materialLanguage}
              patternStyle={s.patternStyle}
              armorLevel={s.armorLevel}
              maskLensStyle={s.maskLensStyle}
              size={180}
              controls={false}
              className="mt-2"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{s.componentCount} components</p>
          </HolographicPanel>
        ))}
      </div>

      <HolographicPanel className="overflow-x-auto p-4">
        <LabSectionLabel>Statistics Comparison</LabSectionLabel>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Stat</th>
              {suits.map((s) => (
                <th key={s.id} className="py-1 pr-3 font-medium text-foreground">
                  {s.codename}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const values = suits.map((s) => s.stats[row.key]);
              const best = row.lowerIsBetter ? Math.min(...values) : Math.max(...values);
              const allSame = values.every((v) => v === values[0]);
              return (
                <tr key={row.key} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-muted">
                    {row.label} {row.unit ? `(${row.unit})` : ""}
                  </td>
                  {suits.map((s, i) => (
                    <td
                      key={s.id}
                      className={`lab-mono py-1.5 pr-3 ${!allSame && values[i] === best ? "font-semibold text-success" : "text-foreground"}`}
                    >
                      {values[i]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </HolographicPanel>
    </div>
  );
}
