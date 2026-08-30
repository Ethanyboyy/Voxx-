/**
 * Shared cinematic timing for every 3D surface.
 *
 * One vocabulary of easings and durations, because motion is the loudest
 * signal of whether a product was designed or assembled. A camera that eases
 * one way and a panel that eases another reads as two apps stitched together,
 * however good each is on its own.
 *
 * Everything here is a pure function of time, so it is unit-testable and does
 * not depend on a render loop existing.
 */

export type Easing = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Slow in, slow out. The default for camera and opacity. */
export const easeInOutCubic: Easing = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Fast start, long settle. For reveals — the eye catches the arrival. */
export const easeOutExpo: Easing = (t) => {
  t = clamp01(t);
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
};

/** Gentle overshoot. For component selection, never for the camera. */
export const easeOutBack: Easing = (t) => {
  t = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Symmetric 0→1→0. For pulses that must return exactly to rest. */
export const pulse: Easing = (t) => {
  t = clamp01(t);
  return Math.sin(t * Math.PI);
};

/**
 * Frame-rate independent exponential approach.
 *
 * The factor to lerp by this frame, given a per-second convergence rate. A
 * fixed per-frame lerp runs visibly faster on a 120 Hz display than on a
 * 60 Hz one, which is the single most common way smooth motion becomes
 * device-dependent.
 */
export function approach(rate: number, delta: number): number {
  return 1 - Math.exp(-rate * delta);
}

/** Canonical durations, in seconds. Named so intent survives refactoring. */
export const DURATION = {
  /** Hover feedback. Must feel instant. */
  instant: 0.12,
  /** Selection highlight, small UI-adjacent moves. */
  quick: 0.28,
  /** Camera focus onto a component. */
  focus: 0.7,
  /** Asset reveal / holographic materialisation. */
  reveal: 1.25,
  /** Exploded view out or back. */
  explode: 0.9,
  /** Zone-to-zone transition in the lab. */
  transit: 1.6,
} as const;

/**
 * A signal travelling along a path, as a pure function of time.
 *
 * Used for neural activity in the Brain: a pulse is a position along an edge
 * plus an intensity envelope, so the same primitive drives a memory recall, a
 * reasoning step and a task execution — only the colour and speed differ.
 */
export interface Signal {
  /** Which path (edge index) this signal travels. */
  path: number;
  /** Seconds since the signal was emitted. */
  age: number;
  /** Seconds to traverse the path. */
  duration: number;
}

export interface SignalSample {
  /** 0..1 along the path. */
  position: number;
  /** 0..1 brightness envelope — fades in at emission and out at arrival. */
  intensity: number;
  /** True once the signal has arrived and should be recycled. */
  done: boolean;
}

export function sampleSignal(signal: Signal): SignalSample {
  const t = signal.duration <= 0 ? 1 : signal.age / signal.duration;
  if (t >= 1) return { position: 1, intensity: 0, done: true };
  // Ease the travel slightly so a signal accelerates away and decelerates in,
  // which reads as intent rather than as a constant-velocity dot.
  return { position: easeInOutCubic(t), intensity: pulse(t), done: false };
}

/**
 * Staggers a set of items so they animate in sequence rather than together.
 *
 * Simultaneous animation of many elements reads as a page load; a stagger
 * reads as a system coming online.
 */
export function stagger(index: number, count: number, total: number): number {
  if (count <= 1) return 0;
  return (index / (count - 1)) * Math.max(0, total);
}

/** Progress of one staggered item at scene time `elapsed`. */
export function staggeredProgress(elapsed: number, delay: number, duration: number): number {
  if (duration <= 0) return 1;
  return clamp01((elapsed - delay) / duration);
}
