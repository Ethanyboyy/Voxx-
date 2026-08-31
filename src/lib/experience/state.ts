import type { SignalKind } from "@/lib/3d/signals";

/**
 * The VOX Experience Core: one state machine for the whole spatial system.
 *
 * Every surface — Brain, Suit Bay, gadget inspection — reads its lighting,
 * camera behaviour and activity level from this single state rather than
 * inventing its own. That is the difference between "an app with 3D in it" and
 * one environment: when VOX starts reasoning, the Brain, the room and the
 * lighting all know at the same instant, because they are all asking the same
 * question.
 *
 * The state is DERIVED, never set decoratively. Its inputs are:
 *
 *  - `brainState`, computed server-side from real AgentRun/SupervisorRun rows
 *  - whether the microphone is genuinely open
 *  - whether a real transition is in flight
 *  - how many real events arrived recently
 *
 * There is deliberately no `setState("thinking")` for the sake of a nicer
 * animation. If VOX is idle, the environment is allowed to look idle.
 */

export type ExperienceState =
  | "idle"
  | "listening"
  | "thinking"
  | "analyzing"
  | "executing"
  | "complete"
  | "error";

export const EXPERIENCE_STATES: readonly ExperienceState[] = [
  "idle",
  "listening",
  "thinking",
  "analyzing",
  "executing",
  "complete",
  "error",
];

/** Server-derived cognitive state (src/lib/brain/graph.ts#getBrainState). */
export type BrainStateName = "idle" | "thinking" | "researching" | "executing" | "waiting" | "learning" | "error";

export interface ExperienceInputs {
  /** Real cognitive state from the server. */
  brainState: BrainStateName;
  /** True only while the microphone is actually open. */
  listening?: boolean;
  /** True while a spatial transition (place → place) is running. */
  transitioning?: boolean;
  /** Seconds since the most recent real event, if any have arrived. */
  secondsSinceEvent?: number | null;
  /** A run that finished successfully within the completion window. */
  justCompleted?: boolean;
}

/**
 * How long "complete" is allowed to hold before settling back to idle.
 *
 * Completion is a moment, not a state to live in — a system that stays lit up
 * green after finishing is claiming to still be doing something.
 */
export const COMPLETE_HOLD_SECONDS = 4;

/**
 * Derives the experience state.
 *
 * Order is precedence, and it is deliberate: an error outranks everything
 * (never animate over a failure), listening outranks cognition (the user is
 * mid-sentence and needs to see they were heard), and execution outranks
 * reasoning (the visible claim should be the strongest thing actually true).
 */
export function deriveExperienceState(inputs: ExperienceInputs): ExperienceState {
  const { brainState, listening, transitioning, secondsSinceEvent, justCompleted } = inputs;

  if (brainState === "error") return "error";
  if (listening) return "listening";
  if (transitioning) return "executing";

  if (brainState === "executing") return "executing";
  if (brainState === "researching" || brainState === "learning") return "analyzing";
  if (brainState === "thinking") return "thinking";

  // A completion only reads as one while it is fresh.
  if (justCompleted && (secondsSinceEvent ?? Infinity) <= COMPLETE_HOLD_SECONDS) return "complete";

  // "waiting" is VOX blocked on the user, not VOX working. It settles rather
  // than pulsing, because pulsing would imply progress that is not happening.
  return "idle";
}

export interface StateCharacter {
  /** Base activity level, 0–1. Drives signal emission rate and glow. */
  intensity: number;
  /** Signal kinds that travel in this state, when no real event overrides. */
  signals: SignalKind[];
  /** Short label for the on-screen readout. Plain language, not jargon. */
  label: string;
  /** Whether motion should feel purposeful (true) or ambient (false). */
  directed: boolean;
}

/**
 * The visual character of each state.
 *
 * Intensities stay low deliberately. The brief is restrained and cinematic:
 * the difference between idle and thinking has to be legible without either
 * one becoming a light show, so the whole scale lives between 0.15 and 0.9 and
 * the gaps between neighbouring states are what carry the meaning.
 */
export const STATE_CHARACTER: Record<ExperienceState, StateCharacter> = {
  idle:      { intensity: 0.15, signals: ["memory"], label: "Idle", directed: false },
  listening: { intensity: 0.45, signals: ["memory", "reasoning"], label: "Listening", directed: true },
  thinking:  { intensity: 0.62, signals: ["reasoning", "memory"], label: "Thinking", directed: true },
  analyzing: { intensity: 0.7, signals: ["reasoning", "memory", "objective"], label: "Analyzing", directed: true },
  executing: { intensity: 0.9, signals: ["execution", "objective"], label: "Executing", directed: true },
  complete:  { intensity: 0.35, signals: ["objective"], label: "Complete", directed: false },
  error:     { intensity: 0.5, signals: ["execution"], label: "Attention needed", directed: false },
};

/**
 * Whether a state change deserves a visible transition beat.
 *
 * Not every change does. Sliding from thinking to analyzing is a continuation;
 * going from idle to executing is an event. Animating both identically makes
 * the important one unremarkable.
 */
export function isMajorTransition(from: ExperienceState, to: ExperienceState): boolean {
  if (from === to) return false;
  if (to === "error" || from === "error") return true;
  if (to === "complete") return true;
  if (from === "idle" || to === "idle") return true;
  // thinking → analyzing → executing is one continuous escalation.
  const ramp: ExperienceState[] = ["listening", "thinking", "analyzing", "executing"];
  return !(ramp.includes(from) && ramp.includes(to));
}
