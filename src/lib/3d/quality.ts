/**
 * Device-aware quality tiers for every 3D surface in VOX.
 *
 * One place decides how heavy a scene is allowed to be, because the same
 * decision was previously being re-made ad hoc inside each canvas — and a
 * phone that renders the Brain acceptably and the Suit Bay badly is a phone
 * that will be judged on the worse of the two.
 *
 * The tier is derived from real signals (device memory, hardware concurrency,
 * viewport, pixel ratio, reduced-motion preference), never from user-agent
 * sniffing: UA strings lie, and a "mobile" branch that misfires on a laptop
 * degrades quality for no reason.
 */

export type QualityTier = "MOBILE" | "MEDIUM" | "HIGH" | "HERO";

export interface QualityBudget {
  /** Cap on devicePixelRatio. The single biggest GPU lever on phones. */
  maxPixelRatio: number;
  /** Multiplier applied to particle/point counts. */
  particleScale: number;
  /** Whether soft shadows are affordable. */
  shadows: boolean;
  /** Whether to run post-processing style effects (bloom-ish additive passes). */
  effects: boolean;
  /** Preferred LOD index: 0 = highest detail. */
  lod: number;
  /** Target texture edge length for streamed assets. */
  maxTextureSize: number;
  /** Max simultaneous animated pulses/signals in a scene. */
  maxAnimatedSignals: number;
}

export const QUALITY_BUDGETS: Record<QualityTier, QualityBudget> = {
  // Deliberately conservative. A phone throttles hard once it heats, so the
  // steady-state budget matters more than the first ten seconds.
  MOBILE: { maxPixelRatio: 2, particleScale: 0.35, shadows: false, effects: false, lod: 2, maxTextureSize: 1024, maxAnimatedSignals: 6 },
  MEDIUM: { maxPixelRatio: 2, particleScale: 0.6, shadows: false, effects: true, lod: 1, maxTextureSize: 2048, maxAnimatedSignals: 12 },
  HIGH: { maxPixelRatio: 2, particleScale: 1.0, shadows: true, effects: true, lod: 0, maxTextureSize: 2048, maxAnimatedSignals: 24 },
  HERO: { maxPixelRatio: 2.5, particleScale: 1.3, shadows: true, effects: true, lod: 0, maxTextureSize: 4096, maxAnimatedSignals: 40 },
};

export interface DeviceSignals {
  /** navigator.deviceMemory, in GB. Absent on Safari — treated as unknown. */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency. */
  cores?: number;
  /** Smaller viewport edge, CSS px. */
  viewportMin?: number;
  devicePixelRatio?: number;
  /** True when the pointer is coarse (touch). */
  coarsePointer?: boolean;
}

/**
 * Classifies a device into a tier.
 *
 * Written as a pure function of signals so it can be unit-tested without a
 * browser — the alternative is a rule that only ever gets exercised on the
 * developer's own laptop.
 */
export function classifyDevice(signals: DeviceSignals): QualityTier {
  const { deviceMemory, cores, viewportMin, devicePixelRatio, coarsePointer } = signals;

  // A coarse pointer on a small viewport is a phone, whatever else it claims.
  const small = (viewportMin ?? 1280) < 768;
  if (coarsePointer && small) {
    // A recent high-core phone can carry MEDIUM; an older one cannot.
    if ((cores ?? 4) >= 6 && (deviceMemory ?? 4) >= 4) return "MEDIUM";
    return "MOBILE";
  }

  // Tablets and small laptops.
  if (small) return "MEDIUM";

  if ((deviceMemory ?? 8) >= 8 && (cores ?? 8) >= 8) {
    // A very high pixel ratio on a large screen means a lot of fragments even
    // at HERO, so it stays HIGH unless the machine is clearly capable.
    return (devicePixelRatio ?? 1) <= 2 ? "HERO" : "HIGH";
  }
  return "HIGH";
}

/** Reads the real signals from the browser. Returns MEDIUM under SSR. */
export function detectQualityTier(): QualityTier {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "MEDIUM";

  const nav = navigator as Navigator & { deviceMemory?: number };
  return classifyDevice({
    deviceMemory: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    viewportMin: Math.min(window.innerWidth, window.innerHeight),
    devicePixelRatio: window.devicePixelRatio,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
}

/** Clamps a requested count to what the tier can afford. */
export function scaleCount(base: number, tier: QualityTier): number {
  return Math.max(1, Math.round(base * QUALITY_BUDGETS[tier].particleScale));
}

/**
 * The `dpr` value to hand React Three Fiber's Canvas.
 *
 * A range lets R3F adapt downward under load rather than committing to one
 * ratio; the floor stays at 1 so text-adjacent geometry never turns to mush.
 */
export function canvasDpr(tier: QualityTier): [number, number] {
  return [1, QUALITY_BUDGETS[tier].maxPixelRatio];
}
