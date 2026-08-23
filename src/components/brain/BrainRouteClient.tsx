"use client";

import { useEffect, useState } from "react";
import { BrainWorkspace, type BrainPayload } from "@/components/brain/BrainWorkspace";
import { VoxBrain3D } from "@/components/brain/three/VoxBrain3D";

const STORAGE_KEY = "vox-brain-view-v2";
type ViewMode = "3D" | "STRUCTURAL";

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

/**
 * The Brain route's entry point: the immersive 3D Brain (VoxBrain3D) is the
 * default experience; the existing 2D graph (BrainWorkspace) survives as an
 * explicit "Structural View" — never the other way around. Same
 * effect-after-mount pattern InfoMode.tsx already uses for its own
 * localStorage-backed preference, and for the same reason: reading
 * localStorage/WebGL support during the initial render would desync from
 * the server-rendered HTML.
 */
export function BrainRouteClient({ initial }: { initial: BrainPayload }) {
  const [view, setView] = useState<ViewMode>("3D");
  const [webglOk, setWebglOk] = useState(true);

  useEffect(() => {
    // One-time reads of real browser/storage state after mount, same
    // pattern (and same lint exemption) as InfoMode.tsx's own
    // localStorage-backed preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(detectWebGL());
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "STRUCTURAL" || stored === "3D") setView(stored);
  }, []);

  function chooseView(next: ViewMode) {
    setView(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  const effectiveView = webglOk ? view : "STRUCTURAL";

  if (effectiveView === "3D") {
    return <VoxBrain3D initial={initial} onSwitchToStructural={() => chooseView("STRUCTURAL")} />;
  }

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end p-3 sm:p-4">
        {webglOk ? (
          <button
            type="button"
            onClick={() => chooseView("3D")}
            className="glass-panel-strong lab-mono pointer-events-auto rounded-full px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            Enter 3D Brain
          </button>
        ) : (
          <span className="glass-panel-strong lab-mono pointer-events-auto rounded-full px-3 py-1.5 text-[11px] text-muted-foreground">
            3D rendering isn&rsquo;t available in this browser — showing the structural view.
          </span>
        )}
      </div>
      <BrainWorkspace initial={initial} />
    </div>
  );
}
