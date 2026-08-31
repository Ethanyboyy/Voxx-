"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SuitBayClient } from "@/components/lab/SuitBayClient";
import type { BaySuitItem } from "@/components/lab/SuitBaySpatial";
import type { BrainStateName } from "@/lib/experience/state";
import { MIN_TOUCH_TARGET_PX } from "@/lib/experience/gestures";

/**
 * The Suit Bay route: a room by default, an archive on request.
 *
 * The spatial bay is the primary experience because the product is a place,
 * not a catalogue. The card list stays reachable — bulk work (filtering ninety
 * suits, creating one, comparing two) is genuinely better as a list, and
 * pretending otherwise would be design for its own sake. It is one tap away
 * and never the thing you land on.
 */

const SuitBaySpatial = dynamic(() => import("@/components/lab/SuitBaySpatial").then((m) => m.SuitBaySpatial), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[32rem] w-full items-center justify-center bg-[#050507]">
      <div className="lab-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Entering suit bay…</div>
    </div>
  ),
});

export function SuitBayRouteClient({
  suits,
  projects,
  brainState,
}: {
  suits: BaySuitItem[];
  projects: Array<{ id: string; name: string }>;
  brainState: BrainStateName;
}) {
  const [mode, setMode] = useState<"bay" | "archive">("bay");
  const router = useRouter();

  if (mode === "bay") {
    return (
      <SuitBaySpatial
        suits={suits}
        brainState={brainState}
        onOpenArchive={() => setMode("archive")}
        onOpenDetail={(id) => router.push(`/lab/suits/${id}`)}
      />
    );
  }

  return (
    <div className="vox-panel-in p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="vox-headline text-2xl">Suit Archive</h1>
          <p className="mt-1 text-sm text-muted">Every suit on record. Filter, compare, and create.</p>
        </div>
        <button
          type="button"
          onClick={() => setMode("bay")}
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          className="shrink-0 rounded-full border border-border bg-surface px-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          Enter Bay
        </button>
      </div>
      <SuitBayClient initialSuits={suits} projects={projects} />
    </div>
  );
}
