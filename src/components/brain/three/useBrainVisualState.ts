"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventStream, type EventStreamStatus } from "@/lib/events/useEventStream";
import { activeSignalKinds, signalWeights, type SignalKind } from "@/lib/3d/signals";
import { SUBJECT_TYPE_TO_SYSTEM, type BrainSystem } from "@/components/brain/three/anatomy";
import type { GraphPatch } from "@/components/brain/InspectorPanel";
import type { BrainNode } from "@/lib/brain/graph";
import type { BrainPayload } from "@/components/brain/BrainWorkspace";
import type { LiveEvent } from "@/lib/events/bus";

/**
 * What the Brain KNOWS, separated from how the Brain LOOKS.
 *
 * VoxBrain3D was carrying both halves: the live graph, the event stream, the
 * signal classification and the per-system pulse clock, alongside camera
 * framing, dissection state, selection and every piece of view state the scene
 * needs. The two change for different reasons — one when VOX does something,
 * the other when the user looks at something — and only the first half is
 * meaningfully testable or reusable.
 *
 * This hook owns the first half. It deliberately does NOT own selection,
 * focus, explode/x-ray/clip, zoom or search: those are things the viewer did,
 * not things VOX did, and moving them here would make the hook a second
 * component rather than a boundary.
 *
 * NOT A SECOND DATA MODEL. The graph is refetched from the one existing
 * endpoint (`/api/brain/graph`), events arrive on the one existing SSE bus,
 * and classification uses the one existing mapping in `lib/3d/signals.ts`.
 * Nothing here is derived from a timer.
 */

/** Milliseconds a system's anchor stays lit after an event touches it. */
const PULSE_MS = 1600;
/** A live event never guesses what changed — it debounces a real re-read. */
const REFRESH_DEBOUNCE_MS = 600;
/** Backstop for anything that changed without emitting an event. */
const POLL_MS = 60000;
/** The event feed is a recent window, not a log. */
const EVENT_WINDOW = 60;

export interface BrainVisualState {
  /** The live graph, refetched authoritatively — never patched from an event. */
  nodes: BrainNode[];
  edges: BrainPayload["edges"];
  events: BrainPayload["events"];
  brain: BrainPayload["brain"];

  /** Node lookup, built once per graph change rather than per consumer. */
  nodesById: Map<string, BrainNode>;

  /** Which cognitive activities are currently travelling. */
  signalKinds: SignalKind[];
  /** The same classification as counts, for the legend. Empty means idle. */
  signalMix: ReturnType<typeof signalWeights>;

  /** Per-system pulse deadlines (performance.now() + PULSE_MS). */
  pulses: Partial<Record<BrainSystem, number>>;

  /** Honest connection state — "connecting" is not "offline". */
  liveStatus: EventStreamStatus;

  /** Force an immediate authoritative re-read. */
  refresh: () => Promise<void>;

  /**
   * Applies an optimistic local edit from the inspector.
   *
   * The inspector writes through a real API route before calling this; the
   * patch only saves the user waiting a poll cycle to see their own edit. It
   * lives here rather than in the component because it mutates the graph, and
   * the graph has exactly one owner.
   */
  applyPatch: (patch: GraphPatch) => void;
}

export function useBrainVisualState(initial: BrainPayload): BrainVisualState {
  const [nodes, setNodes] = useState<BrainNode[]>(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [events, setEvents] = useState(initial.events);
  const [brain, setBrain] = useState(initial.brain);
  const [pulses, setPulses] = useState<Partial<Record<BrainSystem, number>>>({});

  const refreshGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/graph");
      if (!res.ok) return;
      const data: BrainPayload = await res.json();
      setNodes(data.nodes);
      setEdges(data.edges);
      setEvents(data.events);
      setBrain(data.brain);
    } catch {
      // transient network hiccup — the next event or poll retries
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshGraph, POLL_MS);
    return () => clearInterval(interval);
  }, [refreshGraph]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLiveEvent = useCallback(
    (event: LiveEvent) => {
      setEvents((prev) =>
        [
          { id: event.id, type: event.type, subjectType: event.subjectType, subjectId: event.subjectId, createdAt: event.createdAt },
          ...prev,
        ].slice(0, EVENT_WINDOW),
      );

      const system = event.subjectType ? SUBJECT_TYPE_TO_SYSTEM[event.subjectType] : undefined;
      if (system) setPulses((prev) => ({ ...prev, [system]: performance.now() + PULSE_MS }));

      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refreshGraph, REFRESH_DEBOUNCE_MS);
    },
    [refreshGraph],
  );

  // ONE subscription for the whole Brain surface. useEventStream opens exactly
  // one EventSource per hook instance and closes it on unmount, so a remount
  // replaces the connection rather than accumulating a second one.
  const { status: liveStatus } = useEventStream({ onEvent: handleLiveEvent });

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const applyPatch = useCallback((patch: GraphPatch) => {
    if (patch.kind === "addNodes") setNodes((prev) => [...prev, ...patch.nodes]);
    else if (patch.kind === "addEdges") setEdges((prev) => [...prev, ...patch.edges]);
    else if (patch.kind === "updateNode") setNodes((prev) => prev.map((n) => (n.id === patch.id ? { ...n, ...patch.patch } : n)));
  }, []);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Evidence beats summary: a run of memory.created events makes the Brain
  // visibly memory-heavy. `brain.state` is only the fallback for a system that
  // has genuinely done nothing yet.
  const signalKinds = useMemo<SignalKind[]>(() => activeSignalKinds(events, brain.state), [events, brain.state]);
  const signalMix = useMemo(() => signalWeights(events), [events]);

  return { nodes, edges, events, brain, nodesById, signalKinds, signalMix, pulses, liveStatus, refresh: refreshGraph, applyPatch };
}
