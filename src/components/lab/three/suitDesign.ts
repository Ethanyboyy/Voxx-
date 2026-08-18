// Pure, deterministic design-language lookup tables. A suit's holographic 3D
// render is ALWAYS derived from its structured design parameters (silhouette,
// materialLanguage, patternStyle, armorLevel, maskLensStyle) plus its colors —
// the design spec is the source of truth, the render is a visualization of it,
// never the reverse (see build report / master prompt §33).
import * as THREE from "three";

export type Silhouette = "ATHLETIC" | "STREAMLINED" | "ARMORED" | "TACTICAL" | "LIGHTWEIGHT" | "STEALTH";
export type MaterialLanguage = "TEXTILE" | "CARBON_COMPOSITE" | "SYNTHETIC_FIBER" | "FLEXIBLE_POLYMER" | "EXPERIMENTAL_MATERIAL";
export type PatternStyle = "WEB_GEOMETRY" | "GEOMETRIC" | "ORGANIC" | "TECHNICAL" | "MINIMAL";
export type ArmorLevel = "NONE" | "LIGHT" | "MODERATE" | "EXPERIMENTAL";
export type MaskLensStyle = "NARROW" | "WIDE" | "ANGULAR" | "ROUND" | "MECHANICAL";

export interface Proportions {
  torsoWidth: number;
  torsoDepth: number;
  torsoHeight: number;
  limbRadius: number;
  headScale: number;
  shoulderWidth: number;
}

export const SILHOUETTE_PROPORTIONS: Record<Silhouette, Proportions> = {
  ATHLETIC: { torsoWidth: 0.62, torsoDepth: 0.34, torsoHeight: 0.95, limbRadius: 0.115, headScale: 1, shoulderWidth: 0.78 },
  STREAMLINED: { torsoWidth: 0.56, torsoDepth: 0.3, torsoHeight: 0.98, limbRadius: 0.1, headScale: 0.94, shoulderWidth: 0.7 },
  ARMORED: { torsoWidth: 0.74, torsoDepth: 0.44, torsoHeight: 0.92, limbRadius: 0.145, headScale: 1.02, shoulderWidth: 0.94 },
  TACTICAL: { torsoWidth: 0.68, torsoDepth: 0.38, torsoHeight: 0.94, limbRadius: 0.13, headScale: 1, shoulderWidth: 0.86 },
  LIGHTWEIGHT: { torsoWidth: 0.54, torsoDepth: 0.28, torsoHeight: 0.97, limbRadius: 0.095, headScale: 0.92, shoulderWidth: 0.66 },
  STEALTH: { torsoWidth: 0.58, torsoDepth: 0.3, torsoHeight: 0.96, limbRadius: 0.105, headScale: 0.9, shoulderWidth: 0.72 },
};

export interface MaterialSpec {
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  iridescent: boolean;
}

export const MATERIAL_SPECS: Record<MaterialLanguage, MaterialSpec> = {
  TEXTILE: { metalness: 0.08, roughness: 0.78, emissiveIntensity: 0.12, iridescent: false },
  CARBON_COMPOSITE: { metalness: 0.65, roughness: 0.22, emissiveIntensity: 0.16, iridescent: false },
  SYNTHETIC_FIBER: { metalness: 0.2, roughness: 0.52, emissiveIntensity: 0.14, iridescent: false },
  FLEXIBLE_POLYMER: { metalness: 0.35, roughness: 0.38, emissiveIntensity: 0.18, iridescent: false },
  EXPERIMENTAL_MATERIAL: { metalness: 0.55, roughness: 0.12, emissiveIntensity: 0.28, iridescent: true },
};

/** Procedural CanvasTexture — the suit's pattern language rendered as a
 * tileable holographic surface detail (panel lines, web geometry, circuitry)
 * rather than a photographic image. */
export function createPatternTexture(style: PatternStyle, colorPrimary: string, colorSecondary: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  // Base fill is colorPrimary — the suit's dominant, iconic hero color — with
  // colorSecondary drawn as the panel-line/trim pattern on top. (Previously
  // reversed: a colorSecondary fill made the suit read as flat near-black
  // with only faint accent lines, since colorSecondary palette entries are
  // deliberately dark trim/contrast tones, not a base worth covering 100% of
  // the surface in.)
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colorPrimary;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = colorSecondary;
  ctx.globalAlpha = 0.55;

  const cx = size / 2;
  const cy = size / 2;

  switch (style) {
    case "WEB_GEOMETRY": {
      ctx.lineWidth = 1.6;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
        ctx.stroke();
      }
      for (let r = 40; r < size; r += 48) {
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 16) {
          const rr = r * (0.9 + 0.1 * Math.sin(a * 3));
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "GEOMETRIC": {
      ctx.lineWidth = 1.4;
      const step = 42;
      for (let y = 0; y < size + step; y += step) {
        ctx.beginPath();
        for (let x = 0; x <= size; x += step) {
          const offset = (Math.floor(y / step) % 2) * (step / 2);
          ctx.moveTo(x + offset, y);
          ctx.lineTo(x + offset + step / 2, y - step / 2);
          ctx.lineTo(x + offset + step, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "ORGANIC": {
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        const y0 = (i / 14) * size;
        ctx.moveTo(0, y0);
        for (let x = 0; x <= size; x += 16) {
          ctx.lineTo(x, y0 + Math.sin(x * 0.04 + i) * 22);
        }
        ctx.stroke();
      }
      break;
    }
    case "TECHNICAL": {
      ctx.lineWidth = 1.2;
      const step = 28;
      for (let x = 0; x <= size; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 30; i++) {
        const x = Math.floor((Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * (size / step)) * step;
        const y = Math.floor((Math.sin(i * 78.233) * 12543.231 % 1 + 1) % 1 * (size / step)) * step;
        ctx.fillStyle = colorSecondary;
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      break;
    }
    case "MINIMAL": {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.22;
      for (let y = 64; y < size; y += 96) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
