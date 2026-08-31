"use client";

import { useSyncExternalStore } from "react";

/**
 * The user's reduced-motion preference.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, for the same
 * reason the quality tier uses it: the effect version renders once at the wrong
 * answer and then re-renders, which for a 3D surface means building the scene
 * twice. The server snapshot is `false` because SSR has no preference to read,
 * and React treats the hydration difference as expected rather than a mismatch.
 *
 * Motion in VOX is expressive, never load-bearing: honouring this must leave
 * every surface fully correct, just still.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
