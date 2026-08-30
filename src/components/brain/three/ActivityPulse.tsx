"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sampleSignal, type Signal } from "@/lib/3d/animation";
import { QUALITY_BUDGETS, type QualityTier } from "@/lib/3d/quality";
import { SIGNAL_HEX, SIGNAL_KINDS, type SignalKind } from "@/lib/3d/signals";

/**
 * Signals travelling along the Brain's real neural pathways.
 *
 * This is what makes the Brain read as *thinking* rather than as a rotating
 * object. A glowing static network says "there is a brain"; signals moving
 * along its edges, emitted when something actually happens, say "it is
 * working right now" — which is the claim the surface is supposed to make.
 *
 * Two rules keep it honest:
 *
 * 1. **Pulses ride the network's OWN edges.** Positions are interpolated
 *    between the two endpoints of a real edge from `buildNeuralWeb`, so
 *    activity follows the visible structure instead of floating over it.
 * 2. **A pulse is emitted by a real event**, not by a timer pretending to be
 *    one. `activity` is the count of things that have actually happened; when
 *    it rises, signals are emitted. An idle system shows an idle brain.
 *
 * Rendered as a single Points cloud with per-point colour so the whole
 * simulation costs one draw call regardless of signal count — which is what
 * lets it run on a phone at all.
 */

export type { SignalKind };

/**
 * Each kind reads as a distinct colour so the Brain says WHAT it is doing.
 * Built from the single palette in lib/3d/signals so the pulses and the
 * on-screen legend cannot drift apart — a legend that lies about colour is
 * worse than no legend.
 */
const SIGNAL_COLOR: Record<SignalKind, THREE.Color> = Object.fromEntries(
  SIGNAL_KINDS.map((kind) => [kind, new THREE.Color(SIGNAL_HEX[kind])]),
) as Record<SignalKind, THREE.Color>;

/** Seconds to traverse one pathway. Execution is urgent; memory drifts. */
const SIGNAL_DURATION: Record<SignalKind, number> = {
  memory: 1.9,
  reasoning: 1.35,
  objective: 1.6,
  execution: 0.85,
};

interface LiveSignal extends Signal {
  kind: SignalKind;
}

export interface ActivityPulseProps {
  /** Flat vertex positions of the neural web, xyz triples. */
  positions: Float32Array;
  /** Flat edge index pairs into `positions`. */
  edges: Uint16Array | Uint32Array | number[];
  /** Monotonic count of real events. A rise emits signals. */
  activity: number;
  /** What the system is currently doing — drives colour mix. */
  kinds?: SignalKind[];
  tier: QualityTier;
  reducedMotion?: boolean;
  /** Base emission rate in signals per second while active. */
  rate?: number;
}

export function ActivityPulse({
  positions,
  edges,
  activity,
  kinds = ["reasoning"],
  tier,
  reducedMotion = false,
  rate = 2.2,
}: ActivityPulseProps) {
  const budget = QUALITY_BUDGETS[tier];
  const capacity = budget.maxAnimatedSignals;

  const pointsRef = useRef<THREE.Points>(null);
  const signals = useRef<LiveSignal[]>([]);
  const emitAccumulator = useRef(0);
  const lastActivity = useRef(activity);

  const edgeCount = Math.floor((edges as ArrayLike<number>).length / 2);

  const { positionAttr, colorAttr } = useMemo(() => {
    return {
      positionAttr: new Float32Array(capacity * 3),
      colorAttr: new Float32Array(capacity * 3),
    };
  }, [capacity]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positionAttr, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
    return g;
  }, [positionAttr, colorAttr]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // A burst on real activity, so the Brain visibly reacts to events rather
  // than idling at a constant rate.
  useEffect(() => {
    if (activity > lastActivity.current) {
      const burst = Math.min(capacity - signals.current.length, 4);
      for (let i = 0; i < burst; i++) emit();
    }
    lastActivity.current = activity;
    // `emit` is stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, capacity]);

  function emit() {
    if (edgeCount === 0 || signals.current.length >= capacity) return;
    const kind = kinds[Math.floor(Math.random() * kinds.length)] ?? "reasoning";
    signals.current.push({
      path: Math.floor(Math.random() * edgeCount),
      age: 0,
      duration: SIGNAL_DURATION[kind] * (0.85 + Math.random() * 0.3),
      kind,
    });
  }

  useFrame((_, rawDelta) => {
    const points = pointsRef.current;
    if (!points || edgeCount === 0) return;

    // Clamp delta so a backgrounded tab does not teleport every signal to its
    // destination the moment it returns.
    const delta = Math.min(rawDelta, 0.05);

    if (!reducedMotion) {
      emitAccumulator.current += delta * rate;
      while (emitAccumulator.current >= 1) {
        emitAccumulator.current -= 1;
        emit();
      }
    }

    let written = 0;
    const remaining: LiveSignal[] = [];

    for (const signal of signals.current) {
      signal.age += delta;
      const sample = sampleSignal(signal);
      if (sample.done) continue;
      remaining.push(signal);
      if (written >= capacity) continue;

      const a = (edges as ArrayLike<number>)[signal.path * 2] * 3;
      const b = (edges as ArrayLike<number>)[signal.path * 2 + 1] * 3;
      const t = sample.position;

      positionAttr[written * 3] = positions[a] + (positions[b] - positions[a]) * t;
      positionAttr[written * 3 + 1] = positions[a + 1] + (positions[b + 1] - positions[a + 1]) * t;
      positionAttr[written * 3 + 2] = positions[a + 2] + (positions[b + 2] - positions[a + 2]) * t;

      const colour = SIGNAL_COLOR[signal.kind];
      colorAttr[written * 3] = colour.r * sample.intensity;
      colorAttr[written * 3 + 1] = colour.g * sample.intensity;
      colorAttr[written * 3 + 2] = colour.b * sample.intensity;
      written++;
    }

    signals.current = remaining;

    // Park unused slots at the origin with zero colour: additive blending
    // renders black as nothing, so they cost a vertex and show nothing.
    for (let i = written; i < capacity; i++) {
      colorAttr[i * 3] = 0;
      colorAttr[i * 3 + 1] = 0;
      colorAttr[i * 3 + 2] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
