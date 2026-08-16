"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils/cn";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";

export type { SuitLayer } from "@/components/lab/three/SuitRig";
import type { SuitLayer } from "@/components/lab/three/SuitRig";

// A real WebGL holographic viewer (three.js / @react-three/fiber) — smooth
// procedural geometry, PBR-ish holographic materials, orbit controls,
// exploded view, and x-ray layer inspection, all deterministically derived
// from a suit's structured design parameters (never a photograph — see the
// v1.0 redesign report for why: no image-generation provider is configured
// in this project). Loaded via next/dynamic with ssr:false since WebGL only
// exists client-side.
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

export interface HolographicModelProps {
  colorPrimary: string;
  colorSecondary: string;
  visibleLayers?: Set<SuitLayer>;
  className?: string;
  size?: number;
  silhouette?: Silhouette;
  materialLanguage?: MaterialLanguage;
  patternStyle?: PatternStyle;
  armorLevel?: ArmorLevel;
  maskLensStyle?: MaskLensStyle;
  /** Hide the rotate/zoom/x-ray/explode chrome for compact contexts (compare grid). */
  controls?: boolean;
}

const ALL_LAYERS: SuitLayer[] = ["outer", "structural", "thermal", "electronics", "sensors", "mask", "gloves", "boots"];

export function HolographicModel({
  colorPrimary,
  colorSecondary,
  visibleLayers = new Set(ALL_LAYERS),
  className,
  size = 340,
  silhouette = "ATHLETIC",
  materialLanguage = "TEXTILE",
  patternStyle = "WEB_GEOMETRY",
  armorLevel = "LIGHT",
  maskLensStyle = "ANGULAR",
  controls = true,
}: HolographicModelProps) {
  const [xray, setXray] = useState(false);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      <div
        role="img"
        aria-label="Interactive holographic suit model — drag to rotate, scroll to zoom, right-drag to pan"
        className="lab-hologram touch-none select-none"
        style={{ width: size, height: size }}
      >
        <HolographicSuitCanvas
          colorPrimary={colorPrimary}
          colorSecondary={colorSecondary}
          silhouette={silhouette}
          materialLanguage={materialLanguage}
          patternStyle={patternStyle}
          armorLevel={armorLevel}
          maskLensStyle={maskLensStyle}
          visibleLayers={visibleLayers}
          xray={xray}
          explodeAmount={explodeAmount}
          autoRotate={autoRotate}
        />
      </div>

      {controls ? (
        <div className="mt-3 flex w-full max-w-xs flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                autoRotate ? "border-[var(--border-strong)] bg-accent-muted text-accent" : "border-border text-muted hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {autoRotate ? "⏸ Auto-rotate" : "▶ Auto-rotate"}
            </button>
            <button
              type="button"
              onClick={() => setXray((v) => !v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                xray ? "border-[var(--border-strong)] bg-accent-muted text-accent shadow-[0_0_10px_-4px_var(--accent)]" : "border-border text-muted hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {xray ? "✕ Exit X-Ray" : "◎ X-Ray Inspection"}
            </button>
          </div>
          <div className="flex w-full items-center gap-2">
            <span className="lab-mono text-[10px] uppercase tracking-wider text-muted-foreground">Explode</span>
            <input
              type="range"
              min={0}
              max={100}
              value={explodeAmount * 100}
              onChange={(e) => setExplodeAmount(Number(e.target.value) / 100)}
              className="h-1 flex-1 accent-[var(--accent)]"
              aria-label="Exploded view amount"
            />
            <span className="lab-mono w-8 text-right text-[10px] text-muted-foreground">{Math.round(explodeAmount * 100)}%</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
