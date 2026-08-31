/**
 * Choosing the strongest of several candidates.
 *
 * "Make three variations and pick the best" is two different acts, and the
 * second one is where a system usually starts lying. Picking the newest
 * version, or the first, and calling it "the strongest" would produce exactly
 * the same UI as a real comparison while meaning nothing.
 *
 * So selection here is a real review: every candidate is judged against the
 * same requirements by the same reviewer that Visual QA uses, and the winner
 * is the highest score. The per-candidate scores are returned, not just the
 * winner, because a choice you cannot see the reasoning behind is not
 * reviewable — and because two candidates scoring 88 and 87 is a materially
 * different situation from 88 and 41.
 *
 * When no vision provider is configured there is NO fallback to "pick the
 * first". Selection reports that it could not choose. A confident arbitrary
 * pick is worse than an honest refusal, because the user would act on it.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { approveVersion, getArtifact } from "@/lib/artifacts/service";
import { reviewArtifact, BudgetRefusedError } from "@/lib/capabilities/execute";
import { VisionUnavailableError } from "@/lib/qa/service";
import type { QaResult } from "@/lib/qa/types";

export class SelectionUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SelectionUnavailableError";
  }
}

export interface CandidateReview {
  versionId: string;
  version: number;
  url: string;
  score: number;
  status: QaResult["status"];
  /** The reviewer's concrete complaints. Never its reasoning. */
  issues: string[];
}

export interface SelectionResult {
  artifactId: string;
  /** The winner. Null only when nothing could be judged. */
  selected: CandidateReview | null;
  candidates: CandidateReview[];
  /** Plain-language account of how the choice was made. */
  reason: string;
}

export interface SelectBestInput {
  userId: string;
  artifactId: string;
  /** What the candidates are being judged against. */
  requirements: string;
  /** Restrict to specific versions. Absent means every version. */
  versionIds?: string[];
  /** References the candidates should match. */
  referenceVersionIds?: string[];
  traceId?: string;
  agentRunId?: string;
}

/**
 * Reviews every candidate version and approves the best one.
 *
 * Approving is the act that makes a choice real: `getApprovedSuitModel()` and
 * the Lab surfaces read `approved`, so this is what actually promotes a
 * concept into the thing the Suit Bay shows. It is therefore deliberately the
 * LAST thing that happens, after every candidate has been judged.
 */
export async function selectBestVersion(input: SelectBestInput): Promise<SelectionResult> {
  const artifact = await getArtifact(input.userId, input.artifactId);
  if (!artifact) throw new SelectionUnavailableError(`Artifact ${input.artifactId} not found.`);

  const wanted = input.versionIds?.length ? new Set(input.versionIds) : null;
  const candidates = artifact.versions.filter((v) => (wanted ? wanted.has(v.id) : true));

  if (candidates.length === 0) {
    throw new SelectionUnavailableError("There are no candidate versions to choose between.");
  }

  // One candidate is not a comparison. Reviewing it would spend a provider
  // call to discover what is already known: it wins by default.
  if (candidates.length === 1) {
    const only = candidates[0];
    await approveVersion(input.userId, input.artifactId, only.version);
    const single: CandidateReview = {
      versionId: only.id,
      version: only.version,
      url: only.url,
      score: 0,
      status: "PASS",
      issues: [],
    };
    return {
      artifactId: input.artifactId,
      selected: single,
      candidates: [single],
      reason: "Only one candidate existed, so it was approved without a comparison.",
    };
  }

  const reviews: CandidateReview[] = [];
  for (const candidate of candidates) {
    let qa: QaResult;
    try {
      qa = await reviewArtifact({
        userId: input.userId,
        requirements: input.requirements,
        candidateVersionId: candidate.id,
        referenceVersionIds: input.referenceVersionIds,
        traceId: input.traceId,
        agentRunId: input.agentRunId,
      });
    } catch (error) {
      // No reviewer means no basis for a choice at all — not a reason to fall
      // back on an arbitrary one.
      if (error instanceof VisionUnavailableError || error instanceof BudgetRefusedError) {
        throw new SelectionUnavailableError(
          `The candidates could not be compared: ${error.message} Nothing was approved.`,
        );
      }
      throw error;
    }

    reviews.push({
      versionId: candidate.id,
      version: candidate.version,
      url: candidate.url,
      score: qa.score,
      status: qa.status,
      issues: qa.issues.map((i) => i.description),
    });
  }

  // Highest score wins. A PASS is not required: when every candidate fails,
  // the strongest of them is still the answer to "which of these is best",
  // and the caller can see from the scores that none of them passed.
  const ranked = [...reviews].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  await approveVersion(input.userId, input.artifactId, winner.version);

  const anyPassed = reviews.some((r) => r.status === "PASS");
  const reason = anyPassed
    ? `Version ${winner.version} scored highest (${winner.score}/100) of ${reviews.length} candidates.`
    : `No candidate passed review; version ${winner.version} was the strongest at ${winner.score}/100.`;

  await recordEvent({
    userId: input.userId,
    type: "artifact.selected",
    subjectType: "Artifact",
    subjectId: input.artifactId,
    payload: {
      traceId: input.traceId,
      selectedVersion: winner.version,
      scores: reviews.map((r) => ({ version: r.version, score: r.score, status: r.status })),
      anyPassed,
    },
    consequential: true,
  });

  return { artifactId: input.artifactId, selected: winner, candidates: reviews, reason };
}

/**
 * Attaches an artifact to a Lab subject and approves its current version.
 *
 * This is the "added to the Suit Bay" act. It writes no new storage: the Lab
 * already reads Artifact rows filtered by subject (see lib/lab/artifacts.ts),
 * so pointing an artifact at a subject IS the attachment. Approval is the
 * second half — the Suit Bay renders what was approved, never merely what is
 * newest, so an unapproved attachment would be invisible there.
 */
export async function attachArtifactToSubject(options: {
  userId: string;
  artifactId: string;
  subjectType: string;
  subjectId: string;
  traceId?: string;
}) {
  const artifact = await getArtifact(options.userId, options.artifactId);
  if (!artifact) throw new SelectionUnavailableError(`Artifact ${options.artifactId} not found.`);
  if (!artifact.currentVersion) {
    throw new SelectionUnavailableError("That artifact has no version to attach — nothing was produced yet.");
  }

  await db.artifact.update({
    where: { id: artifact.id },
    data: { subjectType: options.subjectType, subjectId: options.subjectId },
  });
  await approveVersion(options.userId, artifact.id, artifact.currentVersion.version);

  await recordEvent({
    userId: options.userId,
    type: "artifact.attached",
    subjectType: "Artifact",
    subjectId: artifact.id,
    payload: {
      traceId: options.traceId,
      subjectType: options.subjectType,
      subjectId: options.subjectId,
      version: artifact.currentVersion.version,
    },
    consequential: true,
  });

  return {
    artifactId: artifact.id,
    subjectType: options.subjectType,
    subjectId: options.subjectId,
    version: artifact.currentVersion.version,
    url: artifact.currentVersion.url,
  };
}
