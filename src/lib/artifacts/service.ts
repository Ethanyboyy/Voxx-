/**
 * The artifact service: create, version, link, and roll back.
 *
 * Two rules this module exists to hold, both of which are easy to violate by
 * accident and expensive to discover later:
 *
 * 1. VERSIONS ARE APPEND-ONLY. Nothing overwrites bytes or mutates a version
 *    row. "Go back to version two" moves `Artifact.currentVersionId`, which
 *    means the thing you went back FROM is still there — the same posture
 *    LabSuitVersion already takes.
 *
 * 2. A VERSION IS ONLY CREATED AFTER BYTES EXIST. The row is written after the
 *    file lands on disk, so there is never a version pointing at nothing. A
 *    failed generation leaves a FAILED CapabilityRun and no artifact, which is
 *    the honest record of what happened.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { storeArtifactBytes, readImageDimensions } from "@/lib/artifacts/store";
import type { ArtifactKind, ArtifactOrigin } from "@/generated/prisma/enums";

export class ArtifactNotFoundError extends Error {
  constructor(id: string) {
    super(`Artifact ${id} not found.`);
    this.name = "ArtifactNotFoundError";
  }
}

export interface CreateArtifactInput {
  userId: string;
  kind: ArtifactKind;
  label: string;
  origin?: ArtifactOrigin;
  note?: string;
  subjectType?: string;
  subjectId?: string;
}

export async function createArtifact(input: CreateArtifactInput) {
  const artifact = await db.artifact.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      label: input.label,
      origin: input.origin ?? "GENERATED",
      note: input.note,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "artifact.created",
    subjectType: "Artifact",
    subjectId: artifact.id,
    payload: { kind: artifact.kind, label: artifact.label },
  });

  return artifact;
}

export interface AddVersionInput {
  userId: string;
  artifactId: string;
  data: Uint8Array;
  mimeType: string;
  provider?: string;
  model?: string;
  prompt?: string;
  parameters?: Record<string, unknown>;
  capabilityRunId?: string;
  durationSeconds?: number;
  /** Versions this one was made from, and how each was used. */
  derivedFrom?: { versionId: string; role: string }[];
}

/**
 * Adds a version. Writes bytes first, then the row.
 *
 * Version numbering reads the current maximum rather than counting rows, so a
 * deleted version cannot cause a number to be reused — a reused version number
 * would silently repoint every lineage reference to it.
 */
export async function addArtifactVersion(input: AddVersionInput) {
  const artifact = await db.artifact.findFirst({
    where: { id: input.artifactId, userId: input.userId },
  });
  if (!artifact) throw new ArtifactNotFoundError(input.artifactId);

  const stored = await storeArtifactBytes(input.data, input.mimeType);
  const dimensions = input.mimeType.startsWith("image/") ? readImageDimensions(input.data) : null;

  const highest = await db.artifactVersion.findFirst({
    where: { artifactId: artifact.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (highest?.version ?? 0) + 1;

  const version = await db.artifactVersion.create({
    data: {
      artifactId: artifact.id,
      version: nextVersion,
      url: stored.url,
      mimeType: input.mimeType,
      bytes: stored.bytes,
      width: dimensions?.width,
      height: dimensions?.height,
      durationSeconds: input.durationSeconds,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      parameters: input.parameters ? JSON.stringify(input.parameters) : undefined,
      capabilityRunId: input.capabilityRunId,
    },
  });

  if (input.derivedFrom?.length) {
    await db.artifactLink.createMany({
      data: input.derivedFrom.map((p) => ({
        parentId: p.versionId,
        childId: version.id,
        role: p.role,
      })),
    });
  }

  // The newest version becomes current. Rolling back is an explicit, separate
  // act — see setCurrentVersion — so generation never silently undoes a
  // deliberate rollback.
  await db.artifact.update({
    where: { id: artifact.id },
    data: { currentVersionId: version.id },
  });

  await recordEvent({
    userId: input.userId,
    type: "artifact.version_created",
    subjectType: "Artifact",
    subjectId: artifact.id,
    payload: {
      version: nextVersion,
      provider: input.provider,
      model: input.model,
      bytes: stored.bytes,
      derivedFrom: input.derivedFrom?.length ?? 0,
    },
  });

  return version;
}

/**
 * Points an artifact at an existing version. This is "go back to version two".
 *
 * Nothing is deleted and nothing is copied forward: the artifact simply refers
 * to a different revision, and every other version remains addressable.
 */
export async function setCurrentVersion(userId: string, artifactId: string, versionNumber: number) {
  const artifact = await db.artifact.findFirst({ where: { id: artifactId, userId } });
  if (!artifact) throw new ArtifactNotFoundError(artifactId);

  const version = await db.artifactVersion.findFirst({
    where: { artifactId, version: versionNumber },
  });
  if (!version) throw new Error(`Artifact ${artifactId} has no version ${versionNumber}.`);

  const updated = await db.artifact.update({
    where: { id: artifactId },
    data: { currentVersionId: version.id },
    include: { currentVersion: true },
  });

  await recordEvent({
    userId,
    type: "artifact.version_selected",
    subjectType: "Artifact",
    subjectId: artifactId,
    payload: { version: versionNumber },
  });

  return updated;
}

/** Marks a version approved — by a human, or by a QA pass that accepted it. */
export async function approveVersion(userId: string, artifactId: string, versionNumber: number) {
  const artifact = await db.artifact.findFirst({ where: { id: artifactId, userId } });
  if (!artifact) throw new ArtifactNotFoundError(artifactId);

  const version = await db.artifactVersion.findFirst({ where: { artifactId, version: versionNumber } });
  if (!version) throw new Error(`Artifact ${artifactId} has no version ${versionNumber}.`);

  return db.artifactVersion.update({ where: { id: version.id }, data: { approved: true } });
}

export async function getArtifact(userId: string, artifactId: string) {
  return db.artifact.findFirst({
    where: { id: artifactId, userId },
    include: {
      currentVersion: true,
      versions: { orderBy: { version: "asc" } },
    },
  });
}

export interface ListArtifactsFilter {
  kind?: ArtifactKind;
  subjectType?: string;
  subjectId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export async function listArtifacts(userId: string, filter: ListArtifactsFilter = {}) {
  return db.artifact.findMany({
    where: {
      userId,
      kind: filter.kind,
      subjectType: filter.subjectType,
      subjectId: filter.subjectId,
      ...(filter.includeArchived ? {} : { archived: false }),
    },
    include: { currentVersion: true },
    orderBy: { updatedAt: "desc" },
    take: filter.limit ?? 50,
  });
}

export interface LineageNode {
  versionId: string;
  artifactId: string;
  artifactLabel: string;
  kind: ArtifactKind;
  version: number;
  provider: string | null;
  role: string | null;
  depth: number;
}

/**
 * Walks a version's ancestry, breadth-first.
 *
 * Bounded by `maxDepth` AND by a visited set. The visited set is not
 * defensive decoration: links are rows, and a bad import or a future
 * "regenerate from" feature could produce a cycle. An unbounded walk over a
 * cycle is an infinite loop inside a request.
 */
export async function getLineage(userId: string, versionId: string, maxDepth = 8): Promise<LineageNode[]> {
  const out: LineageNode[] = [];
  const seen = new Set<string>([versionId]);
  let frontier: { id: string; role: string | null }[] = [{ id: versionId, role: null }];

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const versions = await db.artifactVersion.findMany({
      where: { id: { in: frontier.map((f) => f.id) }, artifact: { userId } },
      include: { artifact: { select: { id: true, label: true, kind: true } } },
    });

    for (const v of versions) {
      out.push({
        versionId: v.id,
        artifactId: v.artifact.id,
        artifactLabel: v.artifact.label,
        kind: v.artifact.kind,
        version: v.version,
        provider: v.provider,
        role: frontier.find((f) => f.id === v.id)?.role ?? null,
        depth,
      });
    }

    const links = await db.artifactLink.findMany({
      where: { childId: { in: versions.map((v) => v.id) } },
    });

    const next: { id: string; role: string | null }[] = [];
    for (const link of links) {
      if (seen.has(link.parentId)) continue;
      seen.add(link.parentId);
      next.push({ id: link.parentId, role: link.role });
    }
    frontier = next;
  }

  return out;
}
