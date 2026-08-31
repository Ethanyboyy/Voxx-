/**
 * The Lab's view of VOX artifacts.
 *
 * The Lab is a CONSUMER of the capability system, not a parallel one. So this
 * module deliberately owns no storage: it reads the same Artifact rows every
 * other surface reads and presents them in the shape the Lab needs, joined to
 * the Lab's own subjects.
 *
 * Nothing here duplicates LabSuitImage. That model is a hand-curated gallery
 * for a suit — a human chose those pictures and captioned them. An Artifact is
 * something VOX produced or was given, with provenance and lineage attached.
 * They answer different questions ("what should I show on the suit page?"
 * versus "where did this come from and what was it made from?"), and merging
 * them would lose the provenance that makes the second question answerable.
 */

import { getArtifact, getLineage, listArtifacts } from "@/lib/artifacts/service";
import type { ArtifactKind } from "@/generated/prisma/enums";

/** The Lab subject an artifact can be attached to. */
export const LAB_SUBJECT_TYPES = ["LabSuit", "LabGadget", "LabProject", "LabExperiment"] as const;
export type LabSubjectType = (typeof LAB_SUBJECT_TYPES)[number];

export interface LabArtifactSummary {
  id: string;
  kind: ArtifactKind;
  label: string;
  origin: string;
  /** The version currently pointed at, if any. */
  current: {
    versionId: string;
    version: number;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    provider: string | null;
    model: string | null;
    approved: boolean;
  } | null;
  versionCount: number;
  updatedAt: Date;
}

/**
 * Artifacts attached to one Lab subject.
 *
 * `kind` narrows to a media type when the caller only wants, say, video for a
 * cinematic panel. Absent means everything, because a suit page legitimately
 * wants concepts, renders and footage together.
 */
export async function listLabArtifacts(
  userId: string,
  subjectType: LabSubjectType,
  subjectId: string,
  kind?: ArtifactKind,
): Promise<LabArtifactSummary[]> {
  const artifacts = await listArtifacts(userId, { subjectType, subjectId, kind });

  const summaries: LabArtifactSummary[] = [];
  for (const artifact of artifacts) {
    // The version count comes from a second read rather than being cached on
    // the row, so it cannot drift away from the actual number of versions.
    const full = await getArtifact(userId, artifact.id);
    summaries.push({
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label,
      origin: artifact.origin,
      current: artifact.currentVersion
        ? {
            versionId: artifact.currentVersion.id,
            version: artifact.currentVersion.version,
            url: artifact.currentVersion.url,
            mimeType: artifact.currentVersion.mimeType,
            width: artifact.currentVersion.width,
            height: artifact.currentVersion.height,
            durationSeconds: artifact.currentVersion.durationSeconds,
            provider: artifact.currentVersion.provider,
            model: artifact.currentVersion.model,
            approved: artifact.currentVersion.approved,
          }
        : null,
      versionCount: full?.versions.length ?? 0,
      updatedAt: artifact.updatedAt,
    });
  }
  return summaries;
}

export interface LabArtifactDetail extends LabArtifactSummary {
  versions: {
    versionId: string;
    version: number;
    url: string;
    mimeType: string;
    provider: string | null;
    model: string | null;
    prompt: string | null;
    approved: boolean;
    createdAt: Date;
  }[];
  /** Where the current version came from, walked back through the link table. */
  lineage: Awaited<ReturnType<typeof getLineage>>;
}

/**
 * One artifact with its full history and provenance.
 *
 * Lineage is resolved for the CURRENT version specifically. Walking every
 * version's ancestry would be most of the graph and answer a question nobody
 * asked; what a person wants to know is where the thing they are looking at
 * came from.
 */
export async function getLabArtifact(userId: string, artifactId: string): Promise<LabArtifactDetail | null> {
  const artifact = await getArtifact(userId, artifactId);
  if (!artifact) return null;

  const lineage = artifact.currentVersionId ? await getLineage(userId, artifact.currentVersionId) : [];

  return {
    id: artifact.id,
    kind: artifact.kind,
    label: artifact.label,
    origin: artifact.origin,
    current: artifact.currentVersion
      ? {
          versionId: artifact.currentVersion.id,
          version: artifact.currentVersion.version,
          url: artifact.currentVersion.url,
          mimeType: artifact.currentVersion.mimeType,
          width: artifact.currentVersion.width,
          height: artifact.currentVersion.height,
          durationSeconds: artifact.currentVersion.durationSeconds,
          provider: artifact.currentVersion.provider,
          model: artifact.currentVersion.model,
          approved: artifact.currentVersion.approved,
        }
      : null,
    versionCount: artifact.versions.length,
    updatedAt: artifact.updatedAt,
    versions: artifact.versions.map((v) => ({
      versionId: v.id,
      version: v.version,
      url: v.url,
      mimeType: v.mimeType,
      provider: v.provider,
      model: v.model,
      prompt: v.prompt,
      approved: v.approved,
      createdAt: v.createdAt,
    })),
    lineage,
  };
}

/**
 * The approved 3D asset for a suit, if there is one.
 *
 * "Approved" rather than "most recent" on purpose. The Suit Bay renders what
 * a human or a QA pass accepted; a newer unreviewed version appearing in the
 * bay automatically would mean an experiment could silently replace the
 * shipped asset.
 */
export async function getApprovedSuitModel(userId: string, suitId: string) {
  const artifacts = await listArtifacts(userId, { subjectType: "LabSuit", subjectId: suitId, kind: "MODEL_3D" });
  for (const artifact of artifacts) {
    if (artifact.currentVersion?.approved) {
      return { artifactId: artifact.id, url: artifact.currentVersion.url, version: artifact.currentVersion.version };
    }
  }
  return null;
}
