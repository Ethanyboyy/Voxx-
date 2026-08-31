/**
 * Bounded iteration: generate, judge, improve, judge again.
 *
 * The loop is the point of the whole fabric — a provider that returns
 * something and a reviewer that says it is wrong are only useful together —
 * but a loop that spends money is also the most dangerous thing here, so
 * every guard is checked BEFORE each attempt rather than after:
 *
 *   1. iteration limit   — hard, and never optional
 *   2. budget            — the ledger's own check, per capability
 *   3. provider          — configured, or there is nothing to attempt
 *
 * Three separate gates because they fail for different reasons and the caller
 * needs to tell them apart: "we tried three times and it is still wrong" is a
 * quality problem, "the daily limit is reached" is a scheduling problem, and
 * "no provider is configured" is a setup problem.
 *
 * Every attempt is persisted as an append-only ArtifactVersion with lineage,
 * including the ones that failed review. Discarding failed attempts would make
 * the history a lie — it would show three clean successes where there was one
 * success and two rejections, and destroy the evidence for why the prompt
 * changed.
 */

import { recordEvent } from "@/lib/observability/events";
import { addArtifactVersion } from "@/lib/artifacts/service";
import { checkBudget, DEFAULT_BUDGET, type BudgetPolicy } from "@/lib/capabilities/ledger";
import type { Capability } from "@/lib/capabilities/types";
import { dominantFailure, type QaFailureKind, type QaResult } from "@/lib/qa/types";

/** What an attempt produced. */
export interface AttemptOutput {
  data: Uint8Array;
  mimeType: string;
  provider: string;
  model: string;
  prompt: string;
  parameters?: Record<string, unknown>;
  capabilityRunId?: string;
  durationSeconds?: number;
}

export interface IterationAttempt {
  attempt: number;
  versionId: string;
  version: number;
  qa: QaResult | null;
  accepted: boolean;
}

export type IterationStop =
  /** QA passed. The good ending. */
  | "ACCEPTED"
  /** Ran out of attempts with the result still failing. */
  | "ITERATION_LIMIT"
  /** The budget declined the next attempt. */
  | "BUDGET"
  /** Generation itself threw. */
  | "GENERATION_FAILED"
  /** QA could not run at all — no vision provider, or it errored. */
  | "REVIEW_UNAVAILABLE";

export interface IterationResult {
  stop: IterationStop;
  attempts: IterationAttempt[];
  /** The best attempt by QA score, which may not be the last one. */
  best: IterationAttempt | null;
  /** Human-readable reason, always populated. */
  reason: string;
}

export interface IterateOptions {
  userId: string;
  artifactId: string;
  capability: Capability;
  traceId: string;
  /** Parent versions every attempt derives from, e.g. the reference image. */
  derivedFrom?: { versionId: string; role: string }[];
  /** Hard ceiling. Falls back to the ledger's default policy. */
  maxIterations?: number;
  budget?: BudgetPolicy;
  /**
   * Produces one candidate. `feedback` is null on the first attempt and
   * carries the previous review's guidance thereafter.
   */
  generate: (attempt: number, feedback: IterationFeedback | null) => Promise<AttemptOutput>;
  /**
   * Judges a candidate. Returning null means review was unavailable — which
   * stops the loop rather than being treated as a pass.
   */
  review?: (output: AttemptOutput, attempt: number) => Promise<QaResult | null>;
}

export interface IterationFeedback {
  /** The single most severe failure kind from the last review. */
  kind: QaFailureKind;
  /** Short, actionable lines to fold into the next attempt. */
  recommendations: string[];
  /** The specific complaints, so the next prompt can address them by name. */
  issues: string[];
  previousScore: number;
}

/**
 * How to respond to a given failure kind.
 *
 * The brief's Phase 7: do not blindly regenerate for every failure. These are
 * genuinely different situations — a mismatch against a reference means the
 * PROMPT was wrong, a smeared texture means the SAMPLE was unlucky, and a
 * render that does not match its design means the CODE is wrong and no amount
 * of regenerating will help.
 */
export type FailureStrategy =
  /** Change the instruction, then generate again. */
  | "REFINE_PROMPT"
  /** Same instruction, new sample. */
  | "REGENERATE"
  /** Not a generation problem — hand back to the execution agent. */
  | "FIX_IMPLEMENTATION"
  /** Something needed is genuinely absent; ask rather than guess. */
  | "ASK_USER"
  /** The provider broke. Retrying the same call is not a strategy. */
  | "ABORT";

export const FAILURE_STRATEGY: Record<QaFailureKind, FailureStrategy> = {
  // The instruction did not convey the target well enough.
  REFERENCE_MISMATCH: "REFINE_PROMPT",
  MATERIAL_PROBLEM: "REFINE_PROMPT",
  PROPORTION_PROBLEM: "REFINE_PROMPT",
  COMPOSITION_PROBLEM: "REFINE_PROMPT",
  // Sampling noise. The prompt was fine; the draw was not.
  GENERATION_ARTIFACT: "REGENERATE",
  // The picture is of the application, and the application is wrong. Nothing
  // a generator does can fix this.
  IMPLEMENTATION_PROBLEM: "FIX_IMPLEMENTATION",
  // Guessing at an absent requirement produces confident, wrong work.
  MISSING_REQUIREMENT: "ASK_USER",
  // A broken reviewer or generator will break again.
  PROVIDER_FAILURE: "ABORT",
};

export function strategyFor(kind: QaFailureKind): FailureStrategy {
  return FAILURE_STRATEGY[kind];
}

function feedbackFrom(qa: QaResult): IterationFeedback | null {
  const kind = dominantFailure(qa);
  if (!kind) return null;
  return {
    kind,
    recommendations: qa.recommendations,
    issues: qa.issues.map((i) => i.description),
    previousScore: qa.score,
  };
}

/**
 * Runs the loop.
 *
 * Never throws for an ordinary bad outcome — a failed generation, an exhausted
 * budget and a rejected result are all returned as an `IterationResult` with a
 * `stop` reason, because they are answers rather than faults, and the caller
 * has to be able to report which one happened.
 */
export async function iterateWithReview(options: IterateOptions): Promise<IterationResult> {
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_BUDGET.maxIterations ?? 3);
  const attempts: IterationAttempt[] = [];
  let feedback: IterationFeedback | null = null;

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    // Budget first: an attempt that cannot be paid for should never be
    // started, and finding out afterwards means it already cost something.
    const budget = await checkBudget(options.userId, options.capability, options.budget ?? DEFAULT_BUDGET);
    if (!budget.allowed) {
      return finish(attempts, "BUDGET", budget.reason ?? "Budget exhausted.");
    }

    await recordEvent({
      userId: options.userId,
      type: "iteration.started",
      subjectType: "Artifact",
      subjectId: options.artifactId,
      payload: { attempt, of: maxIterations, capability: options.capability, traceId: options.traceId },
    });

    let output: AttemptOutput;
    try {
      output = await options.generate(attempt, feedback);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordEvent({
        userId: options.userId,
        type: "iteration.failed",
        subjectType: "Artifact",
        subjectId: options.artifactId,
        payload: { attempt, error: message.slice(0, 300), traceId: options.traceId },
      });
      return finish(attempts, "GENERATION_FAILED", message);
    }

    // Persisted BEFORE review, and kept regardless of the verdict. A rejected
    // attempt is evidence, and it is what the next prompt was written against.
    const version = await addArtifactVersion({
      userId: options.userId,
      artifactId: options.artifactId,
      data: output.data,
      mimeType: output.mimeType,
      provider: output.provider,
      model: output.model,
      prompt: output.prompt,
      parameters: { ...(output.parameters ?? {}), attempt },
      capabilityRunId: output.capabilityRunId,
      durationSeconds: output.durationSeconds,
      derivedFrom: options.derivedFrom,
    });

    if (!options.review) {
      // No reviewer configured: the first result stands. Looping without a
      // way to tell better from worse would just spend money at random.
      const entry: IterationAttempt = { attempt, versionId: version.id, version: version.version, qa: null, accepted: true };
      attempts.push(entry);
      return finish(attempts, "ACCEPTED", "Generated; no review was requested.");
    }

    let qa: QaResult | null;
    try {
      qa = await options.review(output, attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt, versionId: version.id, version: version.version, qa: null, accepted: false });
      return finish(attempts, "REVIEW_UNAVAILABLE", message);
    }

    if (!qa) {
      attempts.push({ attempt, versionId: version.id, version: version.version, qa: null, accepted: false });
      return finish(attempts, "REVIEW_UNAVAILABLE", "No reviewer was available to judge the result.");
    }

    const accepted = qa.status === "PASS";
    attempts.push({ attempt, versionId: version.id, version: version.version, qa, accepted });

    await recordEvent({
      userId: options.userId,
      type: "iteration.completed",
      subjectType: "Artifact",
      subjectId: options.artifactId,
      payload: { attempt, status: qa.status, score: qa.score, traceId: options.traceId },
    });

    if (accepted) return finish(attempts, "ACCEPTED", `Accepted on attempt ${attempt} with a score of ${qa.score}.`);

    feedback = feedbackFrom(qa);

    // Some failures are not worth another generation attempt at all.
    if (feedback) {
      const strategy = strategyFor(feedback.kind);
      if (strategy === "ABORT") {
        return finish(attempts, "REVIEW_UNAVAILABLE", "The reviewer or provider failed; retrying would repeat it.");
      }
      if (strategy === "FIX_IMPLEMENTATION" || strategy === "ASK_USER") {
        // Regenerating cannot fix a code bug or supply a missing requirement.
        // Stopping here and saying so is more useful than two more attempts.
        return finish(
          attempts,
          "ITERATION_LIMIT",
          strategy === "FIX_IMPLEMENTATION"
            ? "The result differs from the design because of the implementation, not the generation — this needs a code change."
            : "A required detail is missing from the request; generating again would only guess at it.",
        );
      }
    }
  }

  return finish(attempts, "ITERATION_LIMIT", `Still failing review after ${maxIterations} attempt(s).`);
}

/** Picks the best attempt by score, preferring an accepted one. */
function finish(attempts: IterationAttempt[], stop: IterationStop, reason: string): IterationResult {
  const accepted = attempts.find((a) => a.accepted);
  const best =
    accepted ??
    [...attempts].sort((a, b) => (b.qa?.score ?? -1) - (a.qa?.score ?? -1))[0] ??
    null;
  return { stop, attempts, best, reason };
}
