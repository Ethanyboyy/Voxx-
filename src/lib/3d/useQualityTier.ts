"use client";

import { useSyncExternalStore } from "react";
import { detectQualityTier, type QualityTier } from "./quality";

/**
 * The device's current quality tier, as a React value.
 *
 * This exists instead of `useState` + `useEffect(() => setTier(detect()))` for
 * two reasons:
 *
 * 1. That pattern renders once at the wrong tier and then re-renders — which
 *    for a 3D canvas means building the scene twice, the second time throwing
 *    away GPU resources allocated by the first.
 * 2. The tier is not a constant. Rotating a phone or dragging a window between
 *    a laptop screen and an external display changes the viewport and pixel
 *    ratio, and therefore what the device can afford. A one-shot read on mount
 *    keeps rendering at the tier the session happened to start in.
 *
 * `useSyncExternalStore` handles both: the server snapshot is the SSR-safe
 * MEDIUM, the client snapshot is the real measurement, and hydration is not a
 * mismatch because React knows the two are allowed to differ.
 */

let cached: QualityTier | null = null;
let queued = false;
const listeners = new Set<() => void>();

function recompute() {
  queued = false;
  const next = detectQualityTier();
  if (next === cached) return;
  cached = next;
  for (const listener of listeners) listener();
}

/** Resize fires continuously during a drag; one recompute per frame is plenty. */
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(recompute);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    }
  };
}

function getSnapshot(): QualityTier {
  if (cached === null) cached = detectQualityTier();
  return cached;
}

function getServerSnapshot(): QualityTier {
  return "MEDIUM";
}

export function useQualityTier(): QualityTier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: forgets the memoised measurement. */
export function resetQualityTierCache(): void {
  cached = null;
}
