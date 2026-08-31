/**
 * Turning a review into instructions for the next attempt.
 *
 * A loop that reads "FAIL" and generates again with the same prompt is not
 * iteration, it is retrying — and retrying a deterministic instruction with a
 * different random seed improves nothing on average. What makes the loop worth
 * its cost is that attempt N+1 receives a DIFFERENT instruction, derived from
 * what attempt N actually got wrong.
 *
 * Two halves, and the second is the one systems usually miss:
 *
 *   CHANGE   — the defects, ordered so the worst is addressed first.
 *   PRESERVE — the dimensions nothing complained about.
 *
 * Without PRESERVE, fixing the shoulders loses the lenses. The generator has
 * no memory between calls; anything not restated is free to drift, and a loop
 * that trades one defect for another can run its full budget and end worse
 * than it started.
 *
 * WHERE `preserve` COMES FROM. The reviewer reports what is WRONG, never what
 * is right, so "what was good" cannot be read off the result directly. It is
 * derived instead: of the criteria the review actually judged, the ones no
 * issue implicated drew no complaint. That is a real signal from real data —
 * weaker than an explicit endorsement, and not presented as one.
 */

import type { QaCriterion, QaFailureKind, QaIssue, QaResult, QaSeverity } from "@/lib/qa/types";

/**
 * Which judged dimensions an issue speaks to.
 *
 * Used only to work out what a review did NOT complain about. Deliberately
 * generous — an issue that might touch a criterion is treated as touching it,
 * because wrongly claiming a dimension was fine is worse than staying quiet
 * about one that was.
 */
const KIND_TOUCHES: Record<QaFailureKind, readonly QaCriterion[]> = {
  REFERENCE_MISMATCH: ["reference_adherence", "subject_identity", "consistency"],
  MATERIAL_PROBLEM: ["material_realism", "texture_quality"],
  PROPORTION_PROBLEM: ["proportions", "geometry_plausibility"],
  COMPOSITION_PROBLEM: ["composition", "lighting"],
  IMPLEMENTATION_PROBLEM: ["reference_adherence", "geometry_plausibility"],
  GENERATION_ARTIFACT: ["visual_artifacts", "geometry_plausibility", "texture_quality"],
  MISSING_REQUIREMENT: ["requested_modifications"],
  // The provider broke; nothing was judged, so nothing is implicated.
  PROVIDER_FAILURE: [],
};

const SEVERITY_RANK: Record<QaSeverity, number> = { BLOCKER: 0, MAJOR: 1, MINOR: 2 };

export interface RevisionDirective {
  /** The defect, in the reviewer's own words. */
  issue: string;
  severity: QaSeverity;
  /** Which judged dimension this speaks to, for the reader and the prompt. */
  kind: QaFailureKind;
  /** 1 is most important. Blockers before majors before minors. */
  priority: number;
  /** What to do about it. Null when the review offered no usable guidance. */
  recommendedChange: string | null;
}

export interface RevisionPlan {
  /** Ordered worst-first. Empty when the review found nothing to change. */
  directives: RevisionDirective[];
  /**
   * Criteria the review judged and no issue implicated. Not an endorsement —
   * an absence of complaint. Restated to the generator so fixing one thing
   * does not silently discard another.
   */
  preserve: QaCriterion[];
  /** The score being improved on. */
  previousScore: number;
  /** Which attempt produced the result this plan is responding to. */
  fromAttempt: number;
}

/**
 * Builds the plan for the next attempt from the review of the best one so far.
 *
 * `fromAttempt` is the attempt being revised, which is NOT always the most
 * recent one: if attempt 2 scored worse than attempt 1, the useful baseline is
 * attempt 1, and revising from the worse result would carry its regressions
 * forward.
 */
export function buildRevisionPlan(qa: QaResult, fromAttempt: number): RevisionPlan {
  const directives = [...qa.issues]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((issue, index) => ({
      issue: issue.description,
      severity: issue.severity,
      kind: issue.kind,
      priority: index + 1,
      recommendedChange: matchRecommendation(issue, qa.recommendations, index),
    }));

  const flagged = new Set<QaCriterion>();
  for (const issue of qa.issues) {
    for (const criterion of KIND_TOUCHES[issue.kind]) flagged.add(criterion);
  }
  const preserve = qa.criteria.filter((criterion) => !flagged.has(criterion));

  return { directives, preserve, previousScore: qa.score, fromAttempt };
}

/**
 * Pairs a recommendation with the issue it addresses.
 *
 * The reviewer returns issues and recommendations as two independent lists
 * with no linkage. Matching by shared vocabulary is a heuristic, so it falls
 * back to positional pairing and then to nothing — an unmatched directive
 * carries `null` rather than an arbitrary recommendation, because attaching
 * the wrong fix to a defect is worse than attaching none.
 */
function matchRecommendation(issue: QaIssue, recommendations: string[], index: number): string | null {
  if (recommendations.length === 0) return null;

  const words = new Set(
    issue.description
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4),
  );
  if (words.size > 0) {
    for (const recommendation of recommendations) {
      const lower = recommendation.toLowerCase();
      let overlap = 0;
      for (const word of words) if (lower.includes(word)) overlap += 1;
      if (overlap >= 2) return recommendation;
    }
  }

  return recommendations[index] ?? null;
}

/**
 * Renders the plan as instruction text appended to the next prompt.
 *
 * Plain imperative lines, worst first. No scores and no meta-commentary about
 * the review: a generator handed "you scored 71/100" tends to describe the
 * critique rather than act on it.
 */
export function renderRevisionInstruction(plan: RevisionPlan): string {
  const lines: string[] = [];

  if (plan.directives.length > 0) {
    lines.push("Revise the previous attempt. Fix these, most important first:");
    for (const directive of plan.directives) {
      const change = directive.recommendedChange ? ` — ${directive.recommendedChange}` : "";
      lines.push(`${directive.priority}. ${directive.issue}${change}`);
    }
  }

  if (plan.preserve.length > 0) {
    lines.push("");
    lines.push(
      `Keep these unchanged, they were not faulted: ${plan.preserve.map((c) => c.replace(/_/g, " ")).join(", ")}.`,
    );
  }

  return lines.join("\n");
}

/** Whether a plan says anything actionable at all. */
export function hasActionableRevision(plan: RevisionPlan): boolean {
  return plan.directives.length > 0;
}
