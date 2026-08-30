import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_CONTRACT_VERSION,
  TIER_BUDGETS,
  modelUrlForSuitAsset,
  summarizeQaReport,
  suitAssetManifestSchema,
  suitAssetMetadataSchema,
  validateAssetBundle,
  type SuitAssetManifest,
  type SuitAssetMetadata,
} from "@/lib/generation/assetContract";

/**
 * The QA gate is what stands between "a .glb exists" and "this may be shown to
 * the user as a real object", so its rules are pinned here rather than left to
 * be re-derived.
 *
 * The first test is the important one: it validates manifest.json and
 * metadata.json that the REAL Blender pipeline actually wrote
 * (tools/3d-pipeline/build_suit.py → contract.py). A hand-written fixture would
 * only prove the validator agrees with itself; this proves the Python writer
 * and the TypeScript gate still agree on the contract.
 */

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "suit-asset");

function loadFixture(): { manifest: SuitAssetManifest; metadata: SuitAssetMetadata } {
  const manifest = suitAssetManifestSchema.parse(
    JSON.parse(readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8")),
  );
  const metadata = suitAssetMetadataSchema.parse(
    JSON.parse(readFileSync(path.join(FIXTURE_DIR, "metadata.json"), "utf8")),
  );
  return { manifest, metadata };
}

describe("suit asset contract", () => {
  it("parses a bundle the real Blender pipeline produced", () => {
    const { manifest, metadata } = loadFixture();

    expect(manifest.contractVersion).toBe(ASSET_CONTRACT_VERSION);
    expect(metadata.provider).toBe("blender-local");
    expect(metadata.recipe).toBe("suit");
    // Authored from anthropometry, not lifted from a third party.
    expect(metadata.provenance.origin).toBe("AUTHORED");

    // The loader's two hard requirements — see ARCHITECTURE.md §1.3.
    expect(metadata.upAxis).toBe("Y");
    expect(metadata.facingAxis).toBe("+Z");

    // Real measured geometry, not placeholder zeroes.
    expect(metadata.stats.triangles).toBeGreaterThan(1000);
    expect(metadata.stats.heightM).toBeGreaterThan(1.5);

    // The bundle carries the script that produced it.
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain("suit.glb");
    expect(paths).toContain("source/build_suit.py");
    // A manifest cannot contain its own checksum.
    expect(paths).not.toContain("manifest.json");
  });

  it("passes that real bundle at HERO tier", () => {
    const { manifest, metadata } = loadFixture();
    const report = validateAssetBundle(manifest, metadata, "HERO");
    expect(summarizeQaReport(report)).toContain("PASS");
    expect(report.verdict).toBe("PASS");
  });

  it("fails the same bundle at MOBILE tier, on budget alone", () => {
    // The tiers have to actually bite — a budget every asset passes is not a
    // budget. This bundle is 66k triangles against MOBILE's 30k.
    const { manifest, metadata } = loadFixture();
    const report = validateAssetBundle(manifest, metadata, "MOBILE");
    expect(report.verdict).toBe("FAIL");
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toContain("triangle-budget");
  });

  it("rejects an asset with no recorded provenance", () => {
    const { manifest, metadata } = loadFixture();
    const stripped = { ...metadata, provenance: { ...metadata.provenance, license: "   " } };
    const report = validateAssetBundle(manifest, stripped, "HERO");
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.find((c) => c.id === "provenance-recorded")?.ok).toBe(false);
  });

  it("requires a source URL when the asset came from a third party", () => {
    const { manifest, metadata } = loadFixture();
    const third = {
      ...metadata,
      provenance: { ...metadata.provenance, origin: "THIRD_PARTY" as const },
    };
    const report = validateAssetBundle(manifest, third, "HERO");
    expect(report.checks.find((c) => c.id === "third-party-attributed")?.ok).toBe(false);
  });

  it("rejects a figure whose height is not its longest axis", () => {
    // A body wider than it is tall is almost always rotated wrong, which reads
    // in the viewer as the suit lying down.
    const { manifest, metadata } = loadFixture();
    const flat = { ...metadata, stats: { ...metadata.stats, heightM: 0.4 } };
    const report = validateAssetBundle(manifest, flat, "HERO");
    expect(report.checks.find((c) => c.id === "height-is-major-axis")?.ok).toBe(false);
  });

  it("rejects the wrong facing axis, because handedness depends on it", () => {
    const { manifest, metadata } = loadFixture();
    const report = validateAssetBundle(manifest, { ...metadata, facingAxis: "-Z" }, "HERO");
    expect(report.checks.find((c) => c.id === "facing-axis")?.ok).toBe(false);
  });

  it("rejects a skinned mesh missing skin attributes or poseable joints", () => {
    const { manifest, metadata } = loadFixture();

    const halfSkinned = {
      ...metadata,
      stats: { ...metadata.stats, skinned: true, joints: 40, skinAttributesComplete: false, boneNames: ["mixamorig:LeftArm"] },
    };
    const a = validateAssetBundle(manifest, halfSkinned, "HERO");
    expect(a.checks.find((c) => c.id === "skin-attributes")?.ok).toBe(false);
    // One named joint is not a poseable skeleton.
    expect(a.checks.find((c) => c.id === "poseable-skeleton")?.ok).toBe(false);
  });

  it("accepts mixamo bone names with either separator", () => {
    // GLTFLoader rewrites "mixamorig:Head" to "mixamorig_Head", so the contract
    // has to accept both spellings or every loaded asset fails its own check.
    const { manifest, metadata } = loadFixture();
    const joints = [
      "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand",
      "RightHand", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg",
    ];
    for (const prefix of ["mixamorig:", "mixamorig_"]) {
      const skinned = {
        ...metadata,
        stats: {
          ...metadata.stats,
          skinned: true,
          joints: joints.length,
          skinAttributesComplete: true,
          boneNames: joints.map((j) => `${prefix}${j}`),
        },
      };
      const report = validateAssetBundle(manifest, skinned, "HERO");
      expect(report.checks.find((c) => c.id === "poseable-skeleton")?.ok).toBe(true);
    }
  });

  it("rejects a bundle missing a required file", () => {
    const { manifest, metadata } = loadFixture();
    const without = { ...manifest, files: manifest.files.filter((f) => f.path !== "suit.glb") };
    const report = validateAssetBundle(without, metadata, "HERO");
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.find((c) => c.id === "required-files")?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "glb-non-empty")?.ok).toBe(false);
  });

  it("rejects a manifest and metadata that disagree about which suit this is", () => {
    const { manifest, metadata } = loadFixture();
    const report = validateAssetBundle({ ...manifest, suitId: "other" }, metadata, "HERO");
    expect(report.checks.find((c) => c.id === "suit-id-match")?.ok).toBe(false);
  });

  it("names failures specifically enough to act on", () => {
    const { manifest, metadata } = loadFixture();
    const report = validateAssetBundle(manifest, metadata, "MOBILE");
    const summary = summarizeQaReport(report);
    expect(summary).toContain("FAIL");
    expect(summary).toContain("triangle-budget");
    // The measured number has to appear, not just the rule name.
    expect(summary).toContain(String(metadata.stats.triangles));
  });

  it("keeps tier budgets ordered", () => {
    expect(TIER_BUDGETS.MOBILE.maxTriangles).toBeLessThan(TIER_BUDGETS.STANDARD.maxTriangles);
    expect(TIER_BUDGETS.STANDARD.maxTriangles).toBeLessThan(TIER_BUDGETS.HERO.maxTriangles);
    expect(TIER_BUDGETS.MOBILE.maxBytes).toBeLessThan(TIER_BUDGETS.HERO.maxBytes);
  });

  it("builds a modelUrl the existing suit validator already accepts", () => {
    // labSchemas.ts permits only paths beginning "/models/suits/", so the
    // per-suit directory layout must not have broken that.
    expect(modelUrlForSuitAsset("mk-vii")).toBe("/models/suits/mk-vii/suit.glb");
    expect(modelUrlForSuitAsset("mk-vii")).toMatch(/^\/models\/suits\//);
  });
});
