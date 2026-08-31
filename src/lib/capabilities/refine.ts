/**
 * The bounded improvement loop, as one unit of work.
 *
 * ARCHITECTURE DECISION — a single step owns the loop; the plan is not mutated
 * while it runs. The alternative considered was inserting extra AgentSteps as
 * attempts are decided on, and it was rejected on the code rather than on
 * taste:
 *
 *   - Step references are keyed by step ORDER (`{{step3.output}}`). Inserting a
 *     step renumbers everything after it, silently repointing every existing
 *     reference. That is a rewrite of the reference contract in the one layer
 *     that must never be subtly wrong.
 *   - Resume is `currentStep` plus per-step status. Insertion changes what
 *     `currentStep` meant when it was written.
 *   - "Produce something that passes" is one logical unit with one outcome, not
 *     N independent units. Modelling it as N makes the run's own history harder
 *     to read, not easier.
 *
 * The cost of that choice is that a step is the executor's unit of recovery, so
 * an interrupted loop would ordinarily restart from attempt 1 and pay for work
 * already done. That is handled here rather than accepted: the loop recovers
 * its position from the ArtifactVersions it already wrote, which are
 * append-only and carry their attempt number. Resuming therefore continues at
 * the next attempt instead of regenerating.
 */

import { recordEvent } from "@/lib/observability/events";
import { addArtifactVersion, approveVersion, createArtifact, getArtifact, readArtifactVersionBytes } from "@/lib/artifacts/service";
import { checkBudget, DEFAULT_BUDGET, completeRun, failRun, newTraceId, openRun, refuseRun } from "@/lib/capabilities/ledger";
import { getImageProvider } from "@/lib/image";
import { runVisualQa, VisionUnavailableError } from "@/lib/qa/service";
import { buildRevisionPlan, renderRevisionInstruction, type RevisionPlan } from "@/lib/capabilities/revision";
import { decideNext, isTerminal, DEFAULT_MIN_IMPROVEMENT, type IterationDecision } from "@/lib/capabilities/decide";
import { CapabilityUnavailableError, BudgetRefusedError } from "@/lib/capabilities/execute";
import type { QaCriterion, QaResult } from "@/lib/qa/types";
import type { ArtifactKind } from "@/generated/prisma/enums";

export interface RefineAttempt {
  attempt: number;
  versionId: string;
  version: number;
  url: string;
  /** Null when the reviewer could not run. */
  qa: QaResult | null;
  decision: IterationDecision;
  reason: string;
  /** What was asked of the NEXT attempt. Null on a terminal decision. */
  revision: RevisionPlan | null;
}

export interface RefineResult {
  artifactId: string;
  attempts: RefineAttempt[];
  /** The approved version. Null when nothing could be judged at all. */
  best: RefineAttempt | null;
  /** Why the loop ended. */
  stoppedBecause: IterationDecision;
  reason: string;
  /** Provider generations actually performed by THIS call. */
  generations: number;
  traceId: string;
}

export interface RefineInput {
  userId: string;
  /** What the result is judged against. */
  requirements: string;
  /** The prompt for generation. Defaults to the requirements. */
  prompt?: string;
  /** Existing artifact to improve. Created when absent. */
  artifactId?: string;
  label?: string;
  subjectType?: string;
  subjectId?: string;
  /** Reference images to condition on and to judge against. */
  referenceVersionIds?: string[];
  criteria?: QaCriterion[] | string;
  /** Hard ceiling. Falls back to the ledger's configured policy. */
  maxIterations?: number;
  /** Score gain below which another attempt is not worth paying for. */
  minImprovement?: number;
  traceId?: string;
  agentRunId?: string;
}

/** Reads how many attempts already exist, so a resumed loop does not repeat them. */
async function completedAttempts(userId: string, artifactId: string): Promise<Map<number, { versionId: string; version: number; url: string }>> {
  const artifact = await getArtifact(userId, artifactId);
  const byAttempt = new Map<number, { versionId: string; version: number; url: string }>();
  for (const version of artifact?.versions ?? []) {
    if (!version.parameters) continue;
    try {
      const parsed = JSON.parse(version.parameters) as Record<string, unknown>;
      if (typeof parsed.attempt === "number") {
        byAttempt.set(parsed.attempt, { versionId: version.id, version: version.version, url: version.url });
      }
    } catch {
      // A version without readable parameters simply is not a recorded attempt.
    }
  }
  return byAttempt;
}

/**
 * Generates, reviews and decides — up to the ceiling.
 *
 * Never throws for an ordinary bad outcome. A failed generation, an exhausted
 * budget and a result that never passes are all returned as a `RefineResult`
 * with a decision, because they are answers rather than faults and the caller
 * has to report which one happened.
 */
export async function refineUntilAcceptable(input: RefineInput): Promise<RefineResult> {
  const traceId = input.traceId ?? newTraceId();
  const maxIterations = Math.max(1, input.maxIterations ?? DEFAULT_BUDGET.maxIterations ?? 3);
  const minImprovement = input.minImprovement ?? DEFAULT_MIN_IMPROVEMENT;
  const prompt = input.prompt ?? input.requirements;

  const provider = getImageProvider();
  if (!provider.isConfigured) {
    throw new CapabilityUnavailableError("IMAGE_GENERATION", provider.unavailableReason ?? "no provider configured");
  }

  // References are loaded once. They are both what generation conditions on
  // and what review judges against, and re-reading them per attempt would be
  // the same bytes off disk three times.
  const references: { versionId: string; data: Uint8Array; mimeType: string }[] = [];
  for (const versionId of input.referenceVersionIds ?? []) {
    const bytes = await readArtifactVersionBytes(input.userId, versionId);
    if (bytes) references.push({ versionId, ...bytes });
  }

  const artifactId =
    input.artifactId ??
    (
      await createArtifact({
        userId: input.userId,
        kind: "IMAGE" as ArtifactKind,
        label: input.label ?? input.requirements.slice(0, 80),
        origin: references.length > 0 ? "DERIVED" : "GENERATED",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      })
    ).id;

  const already = await completedAttempts(input.userId, artifactId);
  const attempts: RefineAttempt[] = [];
  let generations = 0;
  let revision: RevisionPlan | null = null;
  let bestScoreBefore: number | null = null;
  let best: RefineAttempt | null = null;
  let stoppedBecause: IterationDecision = "STOP_MAX_ITERATIONS";
  let reason = `Still failing review after ${maxIterations} attempt(s).`;

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    const resumed = already.get(attempt);

    // Budget is checked before the call, never after: discovering the limit
    // afterwards means it has already been spent.
    if (!resumed) {
      const budget = await checkBudget(input.userId, "IMAGE_GENERATION");
      if (!budget.allowed) {
        await refuseRun({
          userId: input.userId,
          capability: "IMAGE_GENERATION",
          provider: provider.id,
          traceId,
          agentRunId: input.agentRunId,
          reason: budget.reason ?? "Budget exhausted.",
        });
        stoppedBecause = "STOP_PROVIDER_UNAVAILABLE";
        reason = budget.reason ?? "Budget exhausted.";
        break;
      }
    }

    await recordEvent({
      userId: input.userId,
      type: "iteration.started",
      subjectType: "Artifact",
      subjectId: artifactId,
      payload: { traceId, attempt, of: maxIterations, resumed: !!resumed },
    });

    let versionId: string;
    let versionNumber: number;
    let url: string;

    if (resumed) {
      // Already generated in an earlier pass of this run. Re-paying for it is
      // exactly what the recovery path exists to prevent.
      versionId = resumed.versionId;
      versionNumber = resumed.version;
      url = resumed.url;
    } else {
      const instruction = revision ? `${prompt}\n\n${renderRevisionInstruction(revision)}` : prompt;
      const run = await openRun({
        userId: input.userId,
        capability: "IMAGE_GENERATION",
        provider: provider.id,
        model: provider.defaultModel,
        traceId,
        agentRunId: input.agentRunId,
      });

      let generated;
      try {
        generated = await provider.generate({
          prompt: instruction,
          references: references.map((r) => ({ data: r.data, mimeType: r.mimeType })),
          count: 1,
        });
        generations += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failRun(input.userId, run.id, message);
        await recordEvent({
          userId: input.userId,
          type: "iteration.failed",
          subjectType: "Artifact",
          subjectId: artifactId,
          payload: { traceId, attempt, error: message.slice(0, 300) },
        });
        stoppedBecause = "STOP_EXECUTION_FAILURE";
        reason = `Generation failed on attempt ${attempt}: ${message}`;
        break;
      }

      const image = generated.images[0];
      if (!image) {
        await failRun(input.userId, run.id, "The provider returned no image.");
        stoppedBecause = "STOP_EXECUTION_FAILURE";
        reason = `The provider returned no image on attempt ${attempt}.`;
        break;
      }

      // Persisted BEFORE review and kept whatever the verdict. A rejected
      // attempt is evidence, and it is what the next instruction was written
      // against — discarding it would show one clean result where there were
      // three.
      const version = await addArtifactVersion({
        userId: input.userId,
        artifactId,
        data: image.data,
        mimeType: image.mimeType,
        provider: generated.provider,
        model: generated.model,
        prompt: instruction,
        parameters: { attempt, revisionOf: revision?.fromAttempt ?? null },
        capabilityRunId: run.id,
        derivedFrom: references.map((r) => ({ versionId: r.versionId, role: "reference" })),
      });
      await completeRun(input.userId, run.id, { costUsd: generated.costUsd, model: generated.model });

      versionId = version.id;
      versionNumber = version.version;
      url = version.url;

      await recordEvent({
        userId: input.userId,
        type: "iteration.generated",
        subjectType: "Artifact",
        subjectId: artifactId,
        payload: { traceId, attempt, version: versionNumber, revisionOf: revision?.fromAttempt ?? null },
      });
    }

    let qa: QaResult | null = null;
    let reviewFailure: string | null = null;
    const qaBudget = await checkBudget(input.userId, "VISUAL_QA");
    if (!qaBudget.allowed) {
      reviewFailure = qaBudget.reason ?? "Review budget exhausted.";
    } else {
      const qaRun = await openRun({
        userId: input.userId,
        capability: "VISUAL_QA",
        provider: "anthropic",
        traceId,
        agentRunId: input.agentRunId,
      });
      try {
        const bytes = await readArtifactVersionBytes(input.userId, versionId);
        if (!bytes) throw new Error("The generated version has no readable bytes to review.");
        qa = await runVisualQa(input.userId, {
          requirements: input.requirements,
          images: [
            ...references.map((r) => ({ data: r.data, mimeType: r.mimeType, role: "reference" as const })),
            { data: bytes.data, mimeType: bytes.mimeType, role: "candidate" as const },
          ],
          criteria: input.criteria as QaCriterion[] | undefined,
          traceId,
        });
        await completeRun(input.userId, qaRun.id, { model: qa.model });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failRun(input.userId, qaRun.id, message);
        // A missing reviewer is a setup problem, not a bad result. Either way
        // there is no basis for another attempt, so the loop stops rather than
        // treating "could not look" as "looks fine".
        reviewFailure = error instanceof VisionUnavailableError ? error.message : message;
      }
    }

    if (qa) {
      await recordEvent({
        userId: input.userId,
        type: "iteration.reviewed",
        subjectType: "Artifact",
        subjectId: artifactId,
        payload: { traceId, attempt, status: qa.status, score: qa.score, issues: qa.issues.length },
      });
    }

    const verdict = decideNext({ qa, attempt, maxIterations, bestScoreBefore, minImprovement });

    const nextRevision =
      verdict.decision === "ITERATE" && qa
        ? buildRevisionPlan(qa, qa.score >= (bestScoreBefore ?? -1) ? attempt : (best?.attempt ?? attempt))
        : null;

    const entry: RefineAttempt = {
      attempt,
      versionId,
      version: versionNumber,
      url,
      qa,
      decision: verdict.decision,
      reason: reviewFailure && !qa ? reviewFailure : verdict.reason,
      revision: nextRevision,
    };
    attempts.push(entry);

    // The best attempt is the highest scoring one, which is not necessarily the
    // last: a revision can regress, and approving the final attempt regardless
    // would ship the worse image.
    if (!best || (qa?.score ?? -1) > (best.qa?.score ?? -1)) best = entry;
    if (qa) bestScoreBefore = Math.max(bestScoreBefore ?? 0, qa.score);

    if (nextRevision) {
      await recordEvent({
        userId: input.userId,
        type: "iteration.revision_created",
        subjectType: "Artifact",
        subjectId: artifactId,
        payload: {
          traceId,
          attempt,
          fromAttempt: nextRevision.fromAttempt,
          // Operational shape only — counts and dimension names, never the
          // reviewer's prose.
          directives: nextRevision.directives.length,
          preserve: nextRevision.preserve,
        },
      });
    }

    if (isTerminal(verdict.decision)) {
      stoppedBecause = verdict.decision;
      reason = entry.reason;
      break;
    }

    revision = nextRevision;
  }

  // Approval is the last act, and it approves the BEST attempt rather than the
  // final one. The Lab reads `approved`, so this is what decides which image
  // the Suit Bay ends up showing.
  if (best) {
    await approveVersion(input.userId, artifactId, best.version);
  }

  await recordEvent({
    userId: input.userId,
    type: stoppedBecause === "APPROVE" ? "iteration.approved" : "iteration.stopped",
    subjectType: "Artifact",
    subjectId: artifactId,
    payload: {
      traceId,
      decision: stoppedBecause,
      attempts: attempts.length,
      generations,
      selectedVersion: best?.version ?? null,
      finalScore: best?.qa?.score ?? null,
    },
    consequential: true,
  });

  return { artifactId, attempts, best, stoppedBecause, reason, generations, traceId };
}

export { CapabilityUnavailableError, BudgetRefusedError };
