"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DURATION, easeOutBack, easeOutExpo, staggeredProgress } from "@/lib/3d/animation";

/**
 * The reveal: how anything in VOX arrives on screen.
 *
 * An asset that pops into existence at full opacity looks like a page load. An
 * asset that assembles — rising, resolving, settling — looks like a system
 * bringing something up. That difference is the whole reason this exists, and
 * it is why every 3D surface should use the same one rather than each inventing
 * its own entrance.
 *
 * Three things move, on a shared clock:
 *
 * - **Scale** eases with a slight overshoot (`easeOutBack`), which is what
 *   makes it read as arriving under its own power rather than being faded up.
 * - **Height** drops the last few centimetres into place.
 * - **Opacity** resolves last, so the silhouette lands before the detail does.
 *
 * `index`/`count` stagger children of a group so an assembly builds part by
 * part instead of all at once. Reduced motion skips straight to the end state:
 * the animation is expressive, not load-bearing, so removing it must leave the
 * scene fully correct.
 */

export interface MaterializeProps {
  children: React.ReactNode;
  /** Restart the reveal when this changes (e.g. a new asset id). */
  trigger?: string | number;
  /** Position in a staggered set. */
  index?: number;
  count?: number;
  /** Seconds the reveal takes, before stagger. */
  duration?: number;
  /** How far below its resting height the content starts, in world units. */
  rise?: number;
  reducedMotion?: boolean;
  /** Fires once the reveal completes. */
  onRevealed?: () => void;
}

export function Materialize({
  children,
  trigger,
  index = 0,
  count = 1,
  duration = DURATION.reveal,
  rise = 0.12,
  reducedMotion = false,
  onRevealed,
}: MaterializeProps) {
  const group = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const settled = useRef(false);

  // Stagger the whole set across roughly half a reveal, so a ten-part assembly
  // does not take ten times as long to appear as a one-part one.
  const delay = useMemo(() => (count <= 1 ? 0 : (index / (count - 1)) * duration * 0.5), [index, count, duration]);

  useEffect(() => {
    elapsed.current = 0;
    settled.current = false;
  }, [trigger]);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node || settled.current) return;

    const t = reducedMotion ? 1 : staggeredProgress((elapsed.current += delta), delay, duration);

    node.scale.setScalar(0.82 + easeOutBack(t) * 0.18);
    node.position.y = -rise * (1 - easeOutExpo(t));

    // Opacity resolves on the back half so the shape reads first.
    const fade = Math.min(1, Math.max(0, (t - 0.15) / 0.85));
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        // Only fade materials that were already transparent, or are mid-reveal.
        // Forcing transparency permanently onto an opaque material would change
        // its sort order and depth behaviour for the rest of the session.
        if (fade >= 1) {
          if (m.userData.materializeForced) {
            m.transparent = false;
            m.opacity = 1;
            delete m.userData.materializeForced;
          }
          continue;
        }
        if (!m.transparent) {
          m.transparent = true;
          m.userData.materializeForced = true;
        }
        m.opacity = fade;
      }
    });

    if (t >= 1) {
      settled.current = true;
      node.scale.setScalar(1);
      node.position.y = 0;
      onRevealed?.();
    }
  });

  return <group ref={group}>{children}</group>;
}
