/**
 * Running one capability, metered and recorded.
 *
 * These are the functions the capability TOOLS wrap. Keeping them here rather
 * than inline in the registry means the ledger bookkeeping — open a run before
 * the call, close it after, record the cost, attach the artifact — is written
 * once and cannot drift between image, video and QA.
 *
 * The invariant every function holds: a CapabilityRun row exists before the
 * provider is touched and is closed exactly once afterwards, whatever happens.
 * A crash between the two leaves a RUNNING row, which is evidence that money
 * may have been spent — strictly better than no record at all.
 */

import { getImageProvider } from "@/lib/image";
import { getVideoProvider } from "@/lib/video";
import { createArtifact, addArtifactVersion, readArtifactVersionBytes } from "@/lib/artifacts/service";
import { checkBudget, completeRun, failRun, openRun, refuseRun, newTraceId } from "@/lib/capabilities/ledger";
import { runVisualQa } from "@/lib/qa/service";
import type { QaCriterion, QaResult } from "@/lib/qa/types";
import type { ArtifactKind } from "@/generated/prisma/enums";

export class CapabilityUnavailableError extends Error {
  constructor(capability: string, reason: string) {
    super(`${capability} is unavailable: ${reason}`);
    this.name = "CapabilityUnavailableError";
  }
}

export class BudgetRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetRefusedError";
  }
}

/** Parent versions to record lineage against. */
async function loadReferences(userId: string, versionIds: string[] | undefined) {
  const references: { versionId: string; data: Uint8Array; mimeType: string }[] = [];
  for (const versionId of versionIds ?? []) {
    const bytes = await readArtifactVersionBytes(userId, versionId);
    // A reference that cannot be read is skipped rather than fatal — but the
    // caller sees a shorter list, so a prompt that depended on it produces a
    // visibly different result instead of silently the wrong one.
    if (bytes) references.push({ versionId, ...bytes });
  }
  return references;
}

export interface GenerateImageInput {
  userId: string;
  prompt: string;
  /** Artifact to add a version to. Created when absent. */
  artifactId?: string;
  label?: string;
  subjectType?: string;
  subjectId?: string;
  /** Existing artifact versions to condition on. Becomes lineage. */
  referenceVersionIds?: string[];
  count?: number;
  traceId?: string;
  agentRunId?: string;
}

export interface GenerateImageResult {
  artifactId: string;
  versions: { versionId: string; version: number; url: string }[];
  provider: string;
  model: string;
  capabilityRunId: string;
  traceId: string;
}

/** Generates image(s) and stores them as artifact versions. */
export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const provider = getImageProvider();
  const references = await loadReferences(input.userId, input.referenceVersionIds);
  const capability = references.length > 0 ? "IMAGE_EDIT" : "IMAGE_GENERATION";
  const traceId = input.traceId ?? newTraceId();

  if (!provider.isConfigured) {
    throw new CapabilityUnavailableError(capability, provider.unavailableReason ?? "no provider configured");
  }
  if (references.length > 0 && !provider.capabilities.includes("IMAGE_EDIT")) {
    // Silently dropping a reference produces a plausible image of the wrong
    // thing, which is worse than refusing.
    throw new CapabilityUnavailableError(capability, `${provider.displayName} cannot condition on a reference image`);
  }

  const budget = await checkBudget(input.userId, capability);
  if (!budget.allowed) {
    await refuseRun({
      userId: input.userId, capability, provider: provider.id, traceId,
      agentRunId: input.agentRunId, reason: budget.reason ?? "Budget exhausted.",
    });
    throw new BudgetRefusedError(budget.reason ?? "Budget exhausted.");
  }

  const run = await openRun({
    userId: input.userId, capability, provider: provider.id,
    model: provider.defaultModel, traceId, agentRunId: input.agentRunId,
  });

  let result;
  try {
    result = await provider.generate({
      prompt: input.prompt,
      references: references.map((r) => ({ data: r.data, mimeType: r.mimeType })),
      count: input.count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(input.userId, run.id, message);
    throw error;
  }

  // The artifact exists only once bytes are in hand, so a failed generation
  // never leaves an empty artifact behind.
  const artifactId =
    input.artifactId ??
    (await createArtifact({
      userId: input.userId,
      kind: "IMAGE" as ArtifactKind,
      label: input.label ?? input.prompt.slice(0, 80),
      origin: references.length > 0 ? "DERIVED" : "GENERATED",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    })).id;

  const versions: GenerateImageResult["versions"] = [];
  for (const image of result.images) {
    const version = await addArtifactVersion({
      userId: input.userId,
      artifactId,
      data: image.data,
      mimeType: image.mimeType,
      provider: result.provider,
      model: result.model,
      prompt: input.prompt,
      capabilityRunId: run.id,
      derivedFrom: references.map((r) => ({ versionId: r.versionId, role: "reference" })),
    });
    versions.push({ versionId: version.id, version: version.version, url: version.url });
  }

  await completeRun(input.userId, run.id, { costUsd: result.costUsd, model: result.model });
  return { artifactId, versions, provider: result.provider, model: result.model, capabilityRunId: run.id, traceId };
}

export interface GenerateVideoInput {
  userId: string;
  prompt: string;
  label?: string;
  subjectType?: string;
  subjectId?: string;
  /** Frames to animate or keep consistent. Becomes lineage. */
  referenceVersionIds?: string[];
  durationSeconds?: number;
  cameraMotion?: string;
  traceId?: string;
  agentRunId?: string;
}

/**
 * Submits a cinematic job.
 *
 * Returns the JOB, not a finished video: video generation is asynchronous
 * almost everywhere, and pretending otherwise would mean blocking a request
 * for minutes. The CapabilityRun stays RUNNING until a later poll closes it,
 * which is exactly what a long-running external job looks like in the ledger.
 */
export async function submitVideo(input: GenerateVideoInput) {
  const provider = getVideoProvider();
  const traceId = input.traceId ?? newTraceId();

  if (!provider.isConfigured) {
    throw new CapabilityUnavailableError("VIDEO_GENERATION", provider.unavailableReason ?? "no provider configured");
  }

  const budget = await checkBudget(input.userId, "VIDEO_GENERATION");
  if (!budget.allowed) {
    await refuseRun({
      userId: input.userId, capability: "VIDEO_GENERATION", provider: provider.id,
      traceId, agentRunId: input.agentRunId, reason: budget.reason ?? "Budget exhausted.",
    });
    throw new BudgetRefusedError(budget.reason ?? "Budget exhausted.");
  }

  const references = await loadReferences(input.userId, input.referenceVersionIds);
  const run = await openRun({
    userId: input.userId, capability: "VIDEO_GENERATION", provider: provider.id,
    model: provider.defaultModel, traceId, agentRunId: input.agentRunId,
  });

  try {
    const job = await provider.submit({
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      cameraMotion: input.cameraMotion,
      references: references.map((r) => ({ data: r.data, mimeType: r.mimeType, role: "subject" as const })),
    });
    return { job, capabilityRunId: run.id, traceId, referenceVersionIds: references.map((r) => r.versionId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(input.userId, run.id, message);
    throw error;
  }
}

export interface ReviewInput {
  userId: string;
  requirements: string;
  candidateVersionId: string;
  referenceVersionIds?: string[];
  criteria?: QaCriterion[] | string;
  traceId?: string;
  agentRunId?: string;
}

/** Reviews a stored artifact version against requirements and references. */
export async function reviewArtifact(input: ReviewInput): Promise<QaResult> {
  const traceId = input.traceId ?? newTraceId();
  const candidate = await readArtifactVersionBytes(input.userId, input.candidateVersionId);
  if (!candidate) throw new Error(`Artifact version ${input.candidateVersionId} has no readable bytes to review.`);

  const references = await loadReferences(input.userId, input.referenceVersionIds);

  const budget = await checkBudget(input.userId, "VISUAL_QA");
  if (!budget.allowed) {
    await refuseRun({
      userId: input.userId, capability: "VISUAL_QA", provider: "anthropic",
      traceId, agentRunId: input.agentRunId, reason: budget.reason ?? "Budget exhausted.",
    });
    throw new BudgetRefusedError(budget.reason ?? "Budget exhausted.");
  }

  const run = await openRun({
    userId: input.userId, capability: "VISUAL_QA", provider: "anthropic",
    traceId, agentRunId: input.agentRunId,
  });

  try {
    const result = await runVisualQa(input.userId, {
      requirements: input.requirements,
      images: [
        ...references.map((r) => ({ data: r.data, mimeType: r.mimeType, role: "reference" as const })),
        { data: candidate.data, mimeType: candidate.mimeType, role: "candidate" as const },
      ],
      criteria: input.criteria as QaCriterion[] | undefined,
      traceId,
    });
    await completeRun(input.userId, run.id, { model: result.model });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(input.userId, run.id, message);
    throw error;
  }
}
