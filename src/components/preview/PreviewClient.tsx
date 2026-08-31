"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { BrainNode, BrainEdge, BrainNodeType } from "@/lib/brain/graph";
import type { BrainPayload } from "@/components/brain/BrainWorkspace";
import { AssemblyInspector } from "@/components/three/AssemblyInspector";
import { WRIST_ASSEMBLY } from "@/lib/experience/assembly";
import { SCENARIO_SUITS, scenarioEvents, type ScenarioDefinition } from "@/lib/experience/scenarios";

/**
 * Renders one visual QA scenario using the real production components.
 *
 * Nothing in this file reaches the database, the session or a provider — the
 * synthetic state arrives as props from `lib/experience/scenarios`. What it
 * renders is the actual Brain, the actual Suit Bay and the actual inspector,
 * because a preview built from stand-ins would confirm only that the stand-ins
 * look fine.
 */

const VoxBrain3D = dynamic(() => import("@/components/brain/three/VoxBrain3D").then((m) => m.VoxBrain3D), {
  ssr: false,
  loading: () => <PreviewLoading label="Brain" />,
});

const SuitBaySpatial = dynamic(() => import("@/components/lab/SuitBaySpatial").then((m) => m.SuitBaySpatial), {
  ssr: false,
  loading: () => <PreviewLoading label="Suit Bay" />,
});

function PreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050507]">
      <div className="lab-mono text-[10px] uppercase tracking-[0.2em] text-white/25">Loading {label}…</div>
    </div>
  );
}

/**
 * A small synthetic graph.
 *
 * Enough nodes across enough systems that the Brain's clustering, region
 * markers and satellites all have something real to lay out — a graph of three
 * nodes would make every scene look correct by having nothing in it.
 */
function syntheticGraph(): { nodes: BrainNode[]; edges: BrainEdge[] } {
  const spec: Array<[BrainNodeType, string, number]> = [
    ["OBJECTIVE", "Objective", 3],
    ["PROJECT", "Project", 4],
    ["TASK", "Task", 7],
    ["MEMORY", "Memory", 9],
    ["RESEARCH", "Research", 5],
    ["PROPOSAL", "Proposal", 2],
    ["CONNECTION", "Connection", 2],
    ["AGENT_RUN", "Run", 3],
  ];
  const nodes: BrainNode[] = [];
  for (const [type, label, count] of spec) {
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: `${type}:preview-${i}`,
        entityId: `preview-${i}`,
        type,
        label: `${label} ${i + 1}`,
        status: null,
        // Fixed timestamp: a capture that changes between runs cannot be diffed.
        updatedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).toISOString(),
        meta: {},
      });
    }
  }
  // A few real relations so edges are not an empty set.
  const edges: BrainEdge[] = [];
  for (let i = 0; i < 6; i++) {
    const from = nodes[i % nodes.length];
    const to = nodes[(i * 5 + 3) % nodes.length];
    if (from.id === to.id) continue;
    edges.push({ id: `preview-edge-${i}`, from: from.id, to: to.id, relation: "supports" });
  }
  return { nodes, edges };
}

export function PreviewClient({ scenario }: { scenario: ScenarioDefinition }) {
  const payload = useMemo<BrainPayload>(() => {
    const { nodes, edges } = syntheticGraph();
    return {
      nodes,
      edges,
      totals: { memories: 9, research: 5, tasks: 7 },
      brain: { state: scenario.brainState, detail: null },
      events: scenarioEvents(scenario),
    };
  }, [scenario]);

  return (
    <div className="h-[100dvh] w-full bg-[#050507]">
      {/* A single unobtrusive marker so a capture is self-identifying. It sits
          above the surface and is the only thing on screen that is not the
          real product. */}
      <div className="pointer-events-none fixed bottom-2 left-2 z-50 select-none">
        <span className="lab-mono rounded-full bg-black/60 px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-white/35">
          preview · {scenario.id}
        </span>
      </div>

      {scenario.surface === "brain" ? <VoxBrain3D initial={payload} /> : null}

      {scenario.surface === "suit-bay" ? (
        <SuitBaySpatial
          suits={SCENARIO_SUITS}
          brainState={scenario.brainState}
          initialSelectedId={SCENARIO_SUITS[0].id}
          initialFocused={scenario.focused ?? false}
        />
      ) : null}

      {scenario.surface === "wrist" ? (
        <AssemblyInspector
          assembly={WRIST_ASSEMBLY}
          initialExplode={scenario.explode ?? 0}
          initialSelectedId={scenario.selectedPart ?? null}
        />
      ) : null}
    </div>
  );
}
