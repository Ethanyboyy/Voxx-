"use client";

import { useEffect, useState } from "react";

const CORE_VARS = [
  "--core-thinking",
  "--core-executing",
  "--core-listening",
  "--core-success",
  "--core-error",
  "--warning",
  "--muted-foreground",
] as const;

type ColorVar = (typeof CORE_VARS)[number];

function defaults(): Record<ColorVar, string> {
  return {
    "--core-thinking": "#c084fc",
    "--core-executing": "#fbbf24",
    "--core-listening": "#38bdf8",
    "--core-success": "#34d399",
    "--core-error": "#f87171",
    "--warning": "#fbbf24",
    "--muted-foreground": "#77777f",
  };
}

/**
 * Reads the real theme tokens (same --core-* family HoloBrain.tsx already
 * reads for its own theme-aware rendering) rather than hardcoding a second
 * copy of the palette. Re-reads on [data-theme] flips so the 3D Brain
 * follows the same light/dark switch as the rest of the app.
 */
export function useThemeColors(): Record<ColorVar, string> {
  const [colors, setColors] = useState<Record<ColorVar, string>>(defaults);

  useEffect(() => {
    function read() {
      const style = getComputedStyle(document.documentElement);
      const fallback = defaults();
      const next = {} as Record<ColorVar, string>;
      for (const name of CORE_VARS) next[name] = style.getPropertyValue(name).trim() || fallback[name];
      setColors(next);
    }
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
