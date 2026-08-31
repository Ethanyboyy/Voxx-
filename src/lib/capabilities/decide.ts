/**
 * Deciding whether to spend another generation.
 *
 * Extracted from the loop deliberately. Every branch here costs money when it
 * says "go" and costs quality when it wrongly says "stop", and a decision
 * buried inside a for-loop is one nobody can test in isolation. This function
 * is pure: given what has happened, it returns what to do and why.
 *
 * It is NOT a score threshold. A threshold alone gets two things wrong that
 * matter: it keeps paying for attempts that are not getting better, and it
 * keeps retrying failures that regeneration cannot fix (a code bug, a missing
 * requirement) — see FAILURE_STRATEGY.
 */

import { dominantFailure, type QaResult } from "@/lib/qa/types";
import { strategyFor } from "@/lib/capabilities/iterate";

export type IterationDecision =
  /** The result cleared the bar. Stop, successfully. */
  | "APPROVE"
  /** Worth another attempt, and there is guidance for it. */
  | "ITERATE"
  /** The ceiling was reached with the result still failing. */
  | "STOP_MAX_ITERATIONS"
  /** Attempts are no longer getting meaningfully better. */
  | "STOP_NO_MEANINGFUL_IMPROVEMENT"
  /** Regenerating cannot fix this class of failure. */
  | "STOP_NOT_FIXABLE_BY_GENERATION"
  /** No provider, no budget, or no reviewer. */
  | "STOP_PROVIDER_UNAVAILABLE"
  /** Generation itself threw. */
  | "STOP_EXECUTION_FAILURE";

export interface DecisionInput {
  /** The review just returned. Null when review could not run at all. */
  qa: QaResult | null;
  /** 1-based number of the attempt just completed. */
  attempt: number;
  /** Hard ceiling on attempts. */
  maxIterations: number;
  /** Best score seen BEFORE this attempt. Null on the first attempt. */
  bestScoreBefore: number | null;
  /**
   * Smallest score gain that counts as progress. Below it, another attempt is
   * predicted to be more of the same.
   */
  minImprovement: number;
}

export interface Decision {
  decision: IterationDecision;
  /** One line, shown to the user. Always populated. */
  reason: string;
}

/**
 * The default improvement floor.
 *
 * Three points on a 0-100 scale. Reviewer scores are not precise instruments —
 * the same image reviewed twice can differ by a point or two — so a threshold
 * of 1 would read noise as progress and keep paying for it, while a large one
 * would abandon runs that are genuinely climbing slowly.
 */
export const DEFAULT_MIN_IMPROVEMENT = 3;

/**
 * Decides what happens after an attempt has been reviewed.
 *
 * Order matters. Approval is checked first so a passing result never spends
 * another call; unfixable-by-generation is checked before the ceiling so the
 * reason given is the true one rather than "ran out of attempts".
 */
export function decideNext(input: DecisionInput): Decision {
  if (!input.qa) {
    return {
      decision: "STOP_PROVIDER_UNAVAILABLE",
      reason: "No reviewer was available to judge the result, so there is no basis for another attempt.",
    };
  }

  if (input.qa.status === "PASS") {
    return {
      decision: "APPROVE",
      reason: `Passed review on attempt ${input.attempt} with a score of ${input.qa.score}.`,
    };
  }

  // Some failures are not generation problems at all, and another draw cannot
  // touch them. Saying so is more useful than two more attempts and a ceiling.
  const kind = dominantFailure(input.qa);
  if (kind) {
    const strategy = strategyFor(kind);
    if (strategy === "ABORT") {
      return {
        decision: "STOP_PROVIDER_UNAVAILABLE",
        reason: "The reviewer or the generator failed; retrying would repeat it.",
      };
    }
    if (strategy === "FIX_IMPLEMENTATION") {
      return {
        decision: "STOP_NOT_FIXABLE_BY_GENERATION",
        reason:
          "The result differs from the design because of the implementation, not the generation — this needs a code change.",
      };
    }
    if (strategy === "ASK_USER") {
      return {
        decision: "STOP_NOT_FIXABLE_BY_GENERATION",
        reason: "A required detail is missing from the request; generating again would only guess at it.",
      };
    }
  }

  // Stalling is checked before the ceiling: an attempt that gained nothing
  // predicts the next one will not either, and the honest reason is that it
  // stopped improving rather than that it ran out of tries.
  if (input.bestScoreBefore !== null) {
    const gain = input.qa.score - input.bestScoreBefore;
    if (gain < input.minImprovement) {
      return {
        decision: "STOP_NO_MEANINGFUL_IMPROVEMENT",
        reason:
          gain <= 0
            ? `Attempt ${input.attempt} scored ${input.qa.score}, no better than the best so far (${input.bestScoreBefore}). Further attempts are unlikely to help.`
            : `Attempt ${input.attempt} gained ${gain} point(s) over ${input.bestScoreBefore}, below the ${input.minImprovement}-point bar for continuing.`,
      };
    }
  }

  if (input.attempt >= input.maxIterations) {
    return {
      decision: "STOP_MAX_ITERATIONS",
      reason: `Still failing review after ${input.maxIterations} attempt(s); the iteration limit stops here.`,
    };
  }

  return {
    decision: "ITERATE",
    reason: `Attempt ${input.attempt} scored ${input.qa.score} and failed; revising and trying again.`,
  };
}

/** True for the decisions that end the loop. */
export function isTerminal(decision: IterationDecision): boolean {
  return decision !== "ITERATE";
}
