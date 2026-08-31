import { DURATION, easeInOutCubic, easeOutBack, easeOutExpo, type Easing } from "@/lib/3d/animation";

/**
 * The cinematic motion vocabulary.
 *
 * Every animated beat in VOX is one of these, defined once with a duration and
 * an easing. The reason this is a table and not a set of ad-hoc `useSpring`
 * calls scattered through components is legibility: motion is how an
 * environment communicates that it is one system, and two surfaces easing
 * differently is noticeable even when neither is wrong on its own.
 *
 * Durations are deliberately slow-ish. Expensive-feeling motion is unhurried;
 * snappy motion reads as a web page.
 */

export type MotionBeat =
  | "MATERIALIZE"
  | "SCAN"
  | "FOCUS"
  | "ISOLATE"
  | "EXPLODE"
  | "REASSEMBLE"
  | "ORBIT"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "TRANSITION"
  | "ANALYZE"
  | "SUCCESS"
  | "WARNING"
  | "ERROR";

export interface MotionSpec {
  /** Seconds. */
  duration: number;
  ease: Easing;
  /** Seconds of lead-in before the beat starts, for choreographed sequences. */
  delay: number;
  /** Whether reduced-motion should collapse this to an instant state change. */
  decorative: boolean;
}

export const MOTION: Record<MotionBeat, MotionSpec> = {
  // Arrival. Overshoot makes an object read as arriving under its own power.
  MATERIALIZE: { duration: DURATION.reveal, ease: easeOutBack, delay: 0, decorative: true },
  // A pass over a surface. Slow, even, and never looping forever.
  SCAN: { duration: 1.8, ease: easeInOutCubic, delay: 0, decorative: true },
  // Camera settling on a subject. The most-used beat in the product.
  FOCUS: { duration: DURATION.focus, ease: easeOutExpo, delay: 0, decorative: false },
  ISOLATE: { duration: DURATION.focus, ease: easeInOutCubic, delay: 0.05, decorative: false },
  // Taking an assembly apart, and putting it back. Reassembly is slower on
  // purpose: things fly apart quickly and settle precisely.
  EXPLODE: { duration: DURATION.explode, ease: easeOutExpo, delay: 0, decorative: false },
  REASSEMBLE: { duration: DURATION.explode * 1.35, ease: easeInOutCubic, delay: 0, decorative: false },
  ORBIT: { duration: DURATION.transit, ease: easeInOutCubic, delay: 0, decorative: true },
  ACTIVATE: { duration: DURATION.quick, ease: easeOutExpo, delay: 0, decorative: false },
  DEACTIVATE: { duration: DURATION.quick, ease: easeInOutCubic, delay: 0, decorative: false },
  // Place → place. The longest beat: it is the only one that changes context.
  TRANSITION: { duration: DURATION.transit, ease: easeInOutCubic, delay: 0, decorative: false },
  ANALYZE: { duration: 2.4, ease: easeInOutCubic, delay: 0, decorative: true },
  SUCCESS: { duration: DURATION.focus, ease: easeOutExpo, delay: 0, decorative: true },
  WARNING: { duration: DURATION.quick, ease: easeOutExpo, delay: 0, decorative: true },
  ERROR: { duration: DURATION.quick, ease: easeOutExpo, delay: 0, decorative: false },
};

/** Total wall-clock length of a beat, including its lead-in. */
export function beatLength(beat: MotionBeat): number {
  const spec = MOTION[beat];
  return spec.delay + spec.duration;
}

export interface ChoreographedBeat {
  beat: MotionBeat;
  /** Seconds from the start of the sequence. */
  at: number;
}

/**
 * Lays beats out end-to-end with a configurable overlap.
 *
 * Overlap is what separates a sequence from a queue: a transition that starts
 * before the previous beat has fully settled reads as one continuous movement,
 * while strict back-to-back timing reads as a slideshow.
 */
export function choreograph(beats: MotionBeat[], overlap = 0.35): ChoreographedBeat[] {
  let cursor = 0;
  const out: ChoreographedBeat[] = [];
  for (const beat of beats) {
    out.push({ beat, at: cursor });
    cursor += beatLength(beat) * (1 - Math.min(0.9, Math.max(0, overlap)));
  }
  return out;
}

/** Total length of a choreographed sequence, including its final beat. */
export function sequenceLength(beats: MotionBeat[], overlap = 0.35): number {
  const laid = choreograph(beats, overlap);
  if (laid.length === 0) return 0;
  const last = laid[laid.length - 1];
  return last.at + beatLength(last.beat);
}
