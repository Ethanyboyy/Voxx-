/**
 * Visual QA: judging whether produced media is actually good enough.
 *
 * This exists because a provider returning HTTP 200 says nothing about whether
 * the image is any good. Without this layer, "the generation succeeded" and
 * "the result is usable" are the same fact, and they are not — which is how a
 * pipeline confidently ships a suit with six fingers.
 *
 * The output is STRUCTURED, not prose, for two reasons. A caller has to branch
 * on it (iterate, or accept), and prose cannot be branched on reliably. And a
 * failure has to say what KIND of failure it is, because the correct response
 * to "the material looks like armour" is a different prompt, while the correct
 * response to "the mesh has a hole" is a code fix.
 *
 * No chain-of-thought is requested, returned or stored — only the verdict, the
 * issues, and short recommendations.
 */

/** What went wrong, in a form the caller can route on. */
export type QaFailureKind =
  /** The result does not match the reference it was supposed to match. */
  | "REFERENCE_MISMATCH"
  /** Surfaces read as the wrong material. */
  | "MATERIAL_PROBLEM"
  /** Anatomy or scale is wrong. */
  | "PROPORTION_PROBLEM"
  /** Framing, crop, or subject placement is wrong. */
  | "COMPOSITION_PROBLEM"
  /** The rendered application does not match the intended design — a code bug. */
  | "IMPLEMENTATION_PROBLEM"
  /** Generator noise: extra limbs, melted geometry, smeared texture. */
  | "GENERATION_ARTIFACT"
  /** The request asked for something that is simply absent. */
  | "MISSING_REQUIREMENT"
  /** The provider itself failed; nothing was judged. */
  | "PROVIDER_FAILURE";

export const QA_FAILURE_KINDS: readonly QaFailureKind[] = [
  "REFERENCE_MISMATCH",
  "MATERIAL_PROBLEM",
  "PROPORTION_PROBLEM",
  "COMPOSITION_PROBLEM",
  "IMPLEMENTATION_PROBLEM",
  "GENERATION_ARTIFACT",
  "MISSING_REQUIREMENT",
  "PROVIDER_FAILURE",
];

export type QaSeverity = "MINOR" | "MAJOR" | "BLOCKER";

export interface QaIssue {
  kind: QaFailureKind;
  severity: QaSeverity;
  /** One sentence, concrete: "left hand has six fingers", not "anatomy issues". */
  description: string;
}

/**
 * What a task actually cares about.
 *
 * Configurable per task rather than a fixed list, because applying every
 * criterion to every job produces noise: a cinematic shot has no "silhouette"
 * requirement in the sense a suit concept does, and asking about it invites an
 * invented complaint.
 */
export type QaCriterion =
  | "reference_adherence"
  | "composition"
  | "proportions"
  | "geometry_plausibility"
  | "material_realism"
  | "lighting"
  | "texture_quality"
  | "visual_artifacts"
  | "requested_modifications"
  | "consistency"
  | "subject_identity"
  | "overall_quality";

export const ALL_QA_CRITERIA: readonly QaCriterion[] = [
  "reference_adherence",
  "composition",
  "proportions",
  "geometry_plausibility",
  "material_realism",
  "lighting",
  "texture_quality",
  "visual_artifacts",
  "requested_modifications",
  "consistency",
  "subject_identity",
  "overall_quality",
];

/**
 * Sensible criteria per kind of job.
 *
 * These are defaults, not a policy — a caller can pass its own. They encode
 * what actually distinguishes a good result of each kind: a still concept is
 * judged on form and material, a moving shot on continuity and artifacts, and
 * a rendered implementation on whether it matches the design it was built from.
 */
export const CRITERIA_PRESETS: Record<string, readonly QaCriterion[]> = {
  suit_concept: ["reference_adherence", "proportions", "material_realism", "requested_modifications", "overall_quality"],
  concept_art: ["composition", "lighting", "requested_modifications", "overall_quality"],
  cinematic_shot: ["composition", "consistency", "subject_identity", "visual_artifacts", "lighting"],
  implementation_render: ["reference_adherence", "proportions", "geometry_plausibility", "material_realism"],
  generic: ["requested_modifications", "visual_artifacts", "overall_quality"],
};

export interface QaResult {
  status: "PASS" | "FAIL";
  /**
   * 0-100. Only meaningful alongside the issues — a caller choosing between
   * candidates uses it, a caller deciding whether to iterate uses `status`.
   */
  score: number;
  issues: QaIssue[];
  /** Short, actionable. Fed back into the next generation attempt. */
  recommendations: string[];
  /** Which criteria were actually assessed. */
  criteria: QaCriterion[];
  model: string;
  provider: string;
  durationMs: number;
}

/**
 * The single most severe failure kind present, or null on a pass.
 *
 * This is what the iteration loop routes on: a BLOCKER outranks any number of
 * MINOR issues, because fixing three cosmetic complaints while ignoring a hole
 * in the mesh is the wrong order of work.
 */
export function dominantFailure(result: QaResult): QaFailureKind | null {
  if (result.status === "PASS" || result.issues.length === 0) return null;
  const rank: Record<QaSeverity, number> = { BLOCKER: 3, MAJOR: 2, MINOR: 1 };
  return [...result.issues].sort((a, b) => rank[b.severity] - rank[a.severity])[0].kind;
}
