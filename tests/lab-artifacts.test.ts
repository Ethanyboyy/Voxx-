import { describe, it, expect, beforeAll } from "vitest";
import { listLabArtifacts, getLabArtifact, getApprovedSuitModel, LAB_SUBJECT_TYPES } from "@/lib/lab/artifacts";
import { createArtifact, addArtifactVersion, approveVersion, setCurrentVersion } from "@/lib/artifacts/service";
import { createSuit } from "@/lib/lab/suits";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const STATS: SuitStatsInput = {
  stealth: 70, durability: 60, mobility: 80, stretchiness: 60, weightKg: 4, thermalLoadC: 30,
  protection: 40, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 20000, flexibility: 60, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40, confidence: "ESTIMATED",
};

describe("Lab artifact consumption", () => {
  let userId: string;
  let suitId: string;

  beforeAll(async () => {
    userId = (await createTestUser()).id;
    const suit = await createSuit({ userId, codename: "Artifact Subject", archetype: "Utility", stats: STATS });
    suitId = suit.id;
  });

  it("names the Lab subjects an artifact can attach to", () => {
    expect(LAB_SUBJECT_TYPES).toContain("LabSuit");
    expect(LAB_SUBJECT_TYPES).toContain("LabGadget");
  });

  it("lists artifacts attached to a suit, with provenance on the current version", async () => {
    const artifact = await createArtifact({
      userId, kind: "IMAGE", label: "Suit concept", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({
      userId, artifactId: artifact.id, data: PNG, mimeType: "image/png",
      provider: "gemini", model: "gemini-2.5-flash-image", prompt: "fitted technical garment",
    });

    const listed = await listLabArtifacts(userId, "LabSuit", suitId);
    const found = listed.find((a) => a.label === "Suit concept");
    expect(found).toBeDefined();
    // Provenance travels with the artifact — that is what makes it different
    // from a curated LabSuitImage.
    expect(found?.current?.provider).toBe("gemini");
    expect(found?.current?.model).toBe("gemini-2.5-flash-image");
    expect(found?.versionCount).toBe(1);
  });

  it("narrows by media kind", async () => {
    const video = await createArtifact({
      userId, kind: "VIDEO", label: "Reveal", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({ userId, artifactId: video.id, data: PNG, mimeType: "image/png" });

    const videos = await listLabArtifacts(userId, "LabSuit", suitId, "VIDEO");
    expect(videos.every((a) => a.kind === "VIDEO")).toBe(true);
    expect(videos.map((a) => a.label)).toContain("Reveal");
  });

  it("does not leak another user's artifacts", async () => {
    const other = await createTestUser();
    const theirs = await createArtifact({
      userId: other.id, kind: "IMAGE", label: "Theirs", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({ userId: other.id, artifactId: theirs.id, data: PNG, mimeType: "image/png" });

    // Same subject id, different owner.
    const mine = await listLabArtifacts(userId, "LabSuit", suitId);
    expect(mine.map((a) => a.label)).not.toContain("Theirs");
    expect(await getLabArtifact(userId, theirs.id)).toBeNull();
  });

  it("returns the full version history and the lineage of the current version", async () => {
    const reference = await createArtifact({ userId, kind: "IMAGE", label: "Reference photo", origin: "UPLOADED" });
    const referenceVersion = await addArtifactVersion({
      userId, artifactId: reference.id, data: PNG, mimeType: "image/png",
    });

    const concept = await createArtifact({
      userId, kind: "IMAGE", label: "Iterated concept", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({
      userId, artifactId: concept.id, data: PNG, mimeType: "image/png", prompt: "v1",
      derivedFrom: [{ versionId: referenceVersion.id, role: "reference" }],
    });
    await addArtifactVersion({
      userId, artifactId: concept.id, data: PNG, mimeType: "image/png", prompt: "v2",
      derivedFrom: [{ versionId: referenceVersion.id, role: "reference" }],
    });

    const detail = await getLabArtifact(userId, concept.id);
    expect(detail?.versions).toHaveLength(2);
    expect(detail?.versions.map((v) => v.prompt)).toEqual(["v1", "v2"]);
    expect(detail?.lineage.map((n) => n.artifactLabel)).toContain("Reference photo");
  });

  it("shows a rollback as a pointer move, with history intact", async () => {
    const artifact = await createArtifact({
      userId, kind: "IMAGE", label: "Rollbackable", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({ userId, artifactId: artifact.id, data: PNG, mimeType: "image/png", prompt: "one" });
    await addArtifactVersion({ userId, artifactId: artifact.id, data: PNG, mimeType: "image/png", prompt: "two" });
    await setCurrentVersion(userId, artifact.id, 1);

    const detail = await getLabArtifact(userId, artifact.id);
    expect(detail?.current?.version).toBe(1);
    // Nothing was deleted.
    expect(detail?.versions).toHaveLength(2);
  });

  it("serves the APPROVED 3D asset, not merely the newest", async () => {
    // The Suit Bay renders what a human or a QA pass accepted. A newer
    // unreviewed version appearing automatically would let an experiment
    // silently replace the shipped asset.
    const model = await createArtifact({
      userId, kind: "MODEL_3D", label: "Suit mesh", subjectType: "LabSuit", subjectId: suitId,
    });
    await addArtifactVersion({ userId, artifactId: model.id, data: PNG, mimeType: "image/png" });

    expect(await getApprovedSuitModel(userId, suitId)).toBeNull();

    await approveVersion(userId, model.id, 1);
    await setCurrentVersion(userId, model.id, 1);

    const approved = await getApprovedSuitModel(userId, suitId);
    expect(approved?.artifactId).toBe(model.id);
    expect(approved?.version).toBe(1);
  });

  it("stops serving an approved model once an unapproved version becomes current", async () => {
    const model = await createArtifact({
      userId, kind: "MODEL_3D", label: "Superseded mesh", subjectType: "LabSuit", subjectId: `${suitId}-b`,
    });
    await addArtifactVersion({ userId, artifactId: model.id, data: PNG, mimeType: "image/png" });
    await approveVersion(userId, model.id, 1);
    await setCurrentVersion(userId, model.id, 1);
    expect(await getApprovedSuitModel(userId, `${suitId}-b`)).not.toBeNull();

    // A new, unreviewed version arrives and becomes current.
    await addArtifactVersion({ userId, artifactId: model.id, data: PNG, mimeType: "image/png" });
    expect(await getApprovedSuitModel(userId, `${suitId}-b`)).toBeNull();
  });
});
