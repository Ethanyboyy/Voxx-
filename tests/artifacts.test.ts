import { describe, it, expect, beforeAll } from "vitest";
import {
  createArtifact,
  addArtifactVersion,
  setCurrentVersion,
  approveVersion,
  getArtifact,
  getLineage,
  listArtifacts,
  ArtifactNotFoundError,
} from "@/lib/artifacts/service";
import {
  isSupportedMimeType,
  readImageDimensions,
  storeArtifactBytes,
  UnsupportedMimeTypeError,
} from "@/lib/artifacts/store";
import { createTestUser } from "./helpers";

/** A real 1x1 PNG, so header parsing is exercised against actual bytes. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function pngOfSize(width: number, height: number): Uint8Array {
  // Patch the IHDR width/height of the real PNG above. The result is not a
  // decodable image, but it is a real PNG header, which is all the dimension
  // reader looks at — and testing the reader against a hand-built header is
  // the point.
  const copy = Buffer.from(PNG_1X1);
  copy.writeUInt32BE(width, 16);
  copy.writeUInt32BE(height, 20);
  return new Uint8Array(copy);
}

describe("artifact store", () => {
  it("refuses a MIME type it is not prepared to serve", async () => {
    expect(isSupportedMimeType("image/png")).toBe(true);
    expect(isSupportedMimeType("text/html")).toBe(false);
    await expect(storeArtifactBytes(new Uint8Array(PNG_1X1), "text/html"))
      .rejects.toBeInstanceOf(UnsupportedMimeTypeError);
  });

  it("refuses empty bytes", async () => {
    // An empty file is never a successful generation, and storing one would
    // create a version row pointing at nothing.
    await expect(storeArtifactBytes(new Uint8Array(0), "image/png")).rejects.toThrow(/empty/i);
  });

  it("derives the stored path from a UUID, never from provider input", async () => {
    const a = await storeArtifactBytes(new Uint8Array(PNG_1X1), "image/png");
    const b = await storeArtifactBytes(new Uint8Array(PNG_1X1), "image/png");
    expect(a.url).not.toBe(b.url);
    expect(a.url).toMatch(/^\/artifacts\/[0-9a-f]{2}\/[0-9a-f-]{36}\.png$/);
    // No path component is attacker-influenced, so traversal has nothing to
    // work with.
    expect(a.url).not.toContain("..");
  });

  it("reads PNG dimensions from the header", () => {
    expect(readImageDimensions(pngOfSize(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("returns null rather than guessing for an unrecognised header", () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("artifact service", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await createTestUser()).id;
  });

  it("creates an artifact and records the first version as current", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Mark 07 concept" });
    const version = await addArtifactVersion({
      userId,
      artifactId: artifact.id,
      data: pngOfSize(512, 512),
      mimeType: "image/png",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      prompt: "a fitted technical garment",
    });

    expect(version.version).toBe(1);
    expect(version.width).toBe(512);
    expect(version.height).toBe(512);
    // Size is read back from disk, not trusted from the buffer.
    expect(version.bytes).toBeGreaterThan(0);

    const fetched = await getArtifact(userId, artifact.id);
    expect(fetched?.currentVersionId).toBe(version.id);
  });

  it("scopes lookups to the owning user", async () => {
    const other = await createTestUser();
    const theirs = await createArtifact({ userId: other.id, kind: "IMAGE", label: "Theirs" });

    expect(await getArtifact(userId, theirs.id)).toBeNull();
    await expect(
      addArtifactVersion({ userId, artifactId: theirs.id, data: pngOfSize(8, 8), mimeType: "image/png" })
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it("never overwrites — a correction is a new version", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Versioned" });
    const v1 = await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(10, 10), mimeType: "image/png" });
    const v2 = await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(20, 20), mimeType: "image/png" });

    expect(v2.version).toBe(2);
    expect(v2.url).not.toBe(v1.url);

    const fetched = await getArtifact(userId, artifact.id);
    expect(fetched?.versions).toHaveLength(2);
    expect(fetched?.currentVersionId).toBe(v2.id);
  });

  it("'go back to version two' is a pointer move, not a restore", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Rollback" });
    await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(1, 1), mimeType: "image/png" });
    const v2 = await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(2, 2), mimeType: "image/png" });
    const v3 = await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(3, 3), mimeType: "image/png" });

    const rolled = await setCurrentVersion(userId, artifact.id, 2);
    expect(rolled.currentVersionId).toBe(v2.id);

    // The thing rolled back FROM is still addressable — that is the difference
    // between a pointer move and a destructive restore.
    const fetched = await getArtifact(userId, artifact.id);
    expect(fetched?.versions.map((v) => v.id)).toContain(v3.id);
    expect(fetched?.versions).toHaveLength(3);
  });

  it("refuses to select a version that does not exist", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Sparse" });
    await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(1, 1), mimeType: "image/png" });
    await expect(setCurrentVersion(userId, artifact.id, 9)).rejects.toThrow(/no version 9/);
  });

  it("marks a version approved without touching its bytes", async () => {
    const artifact = await createArtifact({ userId, kind: "IMAGE", label: "Approvable" });
    const v1 = await addArtifactVersion({ userId, artifactId: artifact.id, data: pngOfSize(4, 4), mimeType: "image/png" });
    const approved = await approveVersion(userId, artifact.id, 1);
    expect(approved.approved).toBe(true);
    expect(approved.url).toBe(v1.url);
  });

  it("lists artifacts by subject", async () => {
    await createArtifact({ userId, kind: "VIDEO", label: "Reveal", subjectType: "LabSuit", subjectId: "suit-xyz" });
    const found = await listArtifacts(userId, { subjectType: "LabSuit", subjectId: "suit-xyz" });
    expect(found.map((a) => a.label)).toContain("Reveal");
  });
});

describe("artifact lineage", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await createTestUser()).id;
  });

  it("records that a render derived from BOTH a concept and a model", async () => {
    // The reason lineage is a link table rather than a parentId column: a
    // cinematic render legitimately has two parents, and collapsing that to
    // one would silently discard half the provenance.
    const concept = await createArtifact({ userId, kind: "IMAGE", label: "Concept" });
    const conceptV = await addArtifactVersion({ userId, artifactId: concept.id, data: pngOfSize(64, 64), mimeType: "image/png" });

    const model = await createArtifact({ userId, kind: "MODEL_3D", label: "Suit mesh" });
    const modelV = await addArtifactVersion({ userId, artifactId: model.id, data: pngOfSize(32, 32), mimeType: "image/png" });

    const render = await createArtifact({ userId, kind: "VIDEO", label: "Reveal" });
    const renderV = await addArtifactVersion({
      userId,
      artifactId: render.id,
      data: pngOfSize(16, 16),
      mimeType: "image/png",
      derivedFrom: [
        { versionId: conceptV.id, role: "reference" },
        { versionId: modelV.id, role: "source" },
      ],
    });

    const lineage = await getLineage(userId, renderV.id);
    const labels = lineage.map((n) => n.artifactLabel);
    expect(labels).toContain("Reveal");
    expect(labels).toContain("Concept");
    expect(labels).toContain("Suit mesh");

    const conceptNode = lineage.find((n) => n.artifactLabel === "Concept");
    expect(conceptNode?.role).toBe("reference");
    expect(conceptNode?.depth).toBe(1);
  });

  it("terminates on a cycle instead of looping forever", async () => {
    // Links are rows, and a bad import or a future "regenerate from" feature
    // could produce a cycle. An unbounded walk over one is an infinite loop
    // inside a request.
    const a = await createArtifact({ userId, kind: "IMAGE", label: "A" });
    const av = await addArtifactVersion({ userId, artifactId: a.id, data: pngOfSize(8, 8), mimeType: "image/png" });
    const b = await createArtifact({ userId, kind: "IMAGE", label: "B" });
    const bv = await addArtifactVersion({
      userId,
      artifactId: b.id,
      data: pngOfSize(8, 8),
      mimeType: "image/png",
      derivedFrom: [{ versionId: av.id, role: "reference" }],
    });

    const { db } = await import("@/lib/db");
    await db.artifactLink.create({ data: { parentId: bv.id, childId: av.id, role: "cycle" } });

    const lineage = await getLineage(userId, bv.id, 8);
    expect(lineage.length).toBeLessThanOrEqual(4);
  });

  it("does not walk into another user's lineage", async () => {
    const other = await createTestUser();
    const theirs = await createArtifact({ userId: other.id, kind: "IMAGE", label: "Theirs" });
    const theirsV = await addArtifactVersion({ userId: other.id, artifactId: theirs.id, data: pngOfSize(8, 8), mimeType: "image/png" });

    const lineage = await getLineage(userId, theirsV.id);
    expect(lineage).toHaveLength(0);
  });
});
