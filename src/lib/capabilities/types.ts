/**
 * The capability vocabulary — what VOX can decide to *do* about a request.
 *
 * This is the layer the brief's "capability router" routes over. It sits above
 * the provider abstractions (ai/, research/, generation/, image/, video/) and
 * below the callers (chat, Brain, Lab, Supervisor), and its whole job is to let
 * one question be answered well: given what the user asked for, what does this
 * actually require — and, just as often, what does it NOT require.
 *
 * The union is CLOSED, for the same reason the proposal action registry is
 * closed (see src/lib/cognition/proposals.ts): a router that can name a
 * capability nothing implements produces plans that fail at step three instead
 * of at routing time, when the failure is still cheap and legible.
 */

export type Capability =
  /** Multi-step work against the workspace: inspect, edit, test, iterate. */
  | "EXECUTION"
  /** Make an image from a description. */
  | "IMAGE_GENERATION"
  /** Change an existing image, keeping its identity. */
  | "IMAGE_EDIT"
  /** Make temporal media — a shot, a sequence, a reveal. */
  | "VIDEO_GENERATION"
  /** Author or derive 3D geometry. */
  | "MODEL_3D"
  /** Go and find out. */
  | "RESEARCH"
  /** Recall what VOX already knows. */
  | "MEMORY"
  /** Judge whether produced media is actually good enough. */
  | "VISUAL_QA";

export const CAPABILITIES: readonly Capability[] = [
  "EXECUTION",
  "IMAGE_GENERATION",
  "IMAGE_EDIT",
  "VIDEO_GENERATION",
  "MODEL_3D",
  "RESEARCH",
  "MEMORY",
  "VISUAL_QA",
] as const;

/**
 * Permission capability keys, one per capability that reaches something real.
 *
 * These are ordinary keys in the EXISTING permission system — checked with the
 * same `checkCapability()` as everything else, on the same
 * OBSERVE < ANALYZE < RECOMMEND < ASK < ACT ladder.
 *
 * The brief proposed a second vocabulary (READ/WRITE/EXECUTE/NETWORK/DEPLOY/
 * DESTRUCTIVE). Deliberately not adopted: a second permission ladder is a
 * second source of truth about what is allowed, and the first thing to drift
 * out of agreement with the first. Those concerns are expressible here as a
 * key plus a required level — `workspace.write` at ACT is "WRITE",
 * `workspace.exec` at ACT is "EXECUTE", and anything destructive additionally
 * routes through Proposal approval, which is where irreversibility already
 * lives in VOX.
 */
export const CAPABILITY_PERMISSION_KEY: Record<Capability, string | null> = {
  EXECUTION: "agent.execute",
  IMAGE_GENERATION: "media.image.generate",
  IMAGE_EDIT: "media.image.generate",
  VIDEO_GENERATION: "media.video.generate",
  MODEL_3D: "generation.model3d",
  RESEARCH: "research.run",
  // Reading VOX's own memory is governed where memory is read, not here.
  MEMORY: null,
  VISUAL_QA: null,
};

/**
 * Capabilities that spend money at a third party on every call.
 *
 * Used by the router to prefer a cheaper route when one would do, and by the
 * budget check to know which calls to meter.
 */
export const METERED_CAPABILITIES: readonly Capability[] = [
  "IMAGE_GENERATION",
  "IMAGE_EDIT",
  "VIDEO_GENERATION",
  "VISUAL_QA",
] as const;

export function isMetered(capability: Capability): boolean {
  return METERED_CAPABILITIES.includes(capability);
}

/** One capability in a plan, with why it is there. */
export interface CapabilityStep {
  capability: Capability;
  /**
   * A short OPERATIONAL reason — "request asks for a moving shot", not a
   * rationale. The brief is explicit that hidden reasoning must not be exposed
   * or stored; this field exists so a person reading the activity feed can
   * tell what VOX thought it was doing, and is capped accordingly.
   */
  reason: string;
  /**
   * Optional steps may be skipped when their provider is unavailable, without
   * failing the plan. A required step's absence fails the plan at routing
   * time, which is the honest moment to fail.
   */
  optional: boolean;
}

/** What the router decided. An EMPTY plan is a real, common answer. */
export interface CapabilityPlan {
  steps: CapabilityStep[];
  /**
   * How the plan was reached. `direct` means no capability is needed and VOX
   * should simply answer — the router must be able to say that, or it will
   * reach for a provider merely because one exists.
   */
  strategy: "direct" | "deterministic" | "model_assisted";
  /** Set when the plan could not be fully satisfied by configured providers. */
  degraded: boolean;
  /** Human-readable notes about degradation, e.g. an unconfigured provider. */
  notes: string[];
}

export const EMPTY_PLAN: CapabilityPlan = {
  steps: [],
  strategy: "direct",
  degraded: false,
  notes: [],
};
