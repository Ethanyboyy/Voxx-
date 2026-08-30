import { describe, expect, it } from "vitest";
import {
  suitAssetManifestSchema,
  suitAssetMetadataSchema,
  validateAssetBundle,
  type SuitAssetManifest,
  type SuitAssetMetadata,
} from "@/lib/generation/assetContract";

/**
 * Guards for the failure modes the baked-texture pass introduced.
 *
 * These exist for one specific reason. The pipeline produced, on three
 * consecutive builds, an asset that passed EVERY existing check — right
 * triangle count, right bounds, right provenance, valid GLB — while every
 * single baked map was pure black. Assigning `colorspace_settings.name` after
 * writing pixels silently zeroes Blender's buffer, and nothing in the contract
 * could tell a textured asset from an untextured one.
 *
 * A gate that cannot distinguish those two states is not a gate, so the
 * texture facts are now part of it.
 */

const BASE_MANIFEST: SuitAssetManifest = {
  contractVersion: 1,
  suitId: "vox-master",
  generatedAt: "2026-08-30T00:00:00Z",
  files: [
    { path: "suit.glb", bytes: 4_200_000, sha256: "a".repeat(64) },
    { path: "metadata.json", bytes: 3200, sha256: "b".repeat(64) },
  ],
};

const BASE_METADATA: SuitAssetMetadata = {
  contractVersion: 1,
  suitId: "vox-master",
  provider: "blender-local",
  recipe: "suit",
  provenance: {
    origin: "AUTHORED",
    description: "Authored in Blender from anthropometry.",
    license: "Owned by this project.",
  },
  upAxis: "Y",
  facingAxis: "+Z",
  generatedAt: "2026-08-30T00:00:00Z",
  stats: {
    triangles: 72_332,
    vertices: 36_102,
    meshes: 14,
    materials: 6,
    heightM: 1.7216,
    widthM: 0.6046,
    depthM: 0.2574,
    skinned: false,
    joints: 0,
    skinAttributesComplete: true,
    uvMeshes: 14,
    textures: [
      { name: "vox_garment_basecolor", size: 4096 },
      { name: "vox_garment_roughness", size: 4096 },
      { name: "vox_garment_normal", size: 4096 },
      { name: "vox_mask_basecolor", size: 2048 },
      { name: "vox_mask_roughness", size: 2048 },
      { name: "vox_mask_normal", size: 2048 },
    ],
  },
};

function check(metadata: SuitAssetMetadata, id: string) {
  const report = validateAssetBundle(BASE_MANIFEST, metadata, "HERO");
  return report.checks.find((c) => c.id === id);
}

describe("baked texture guards", () => {
  it("accepts a fully textured asset", () => {
    const report = validateAssetBundle(BASE_MANIFEST, BASE_METADATA, "HERO");
    expect(report.verdict).toBe("PASS");
  });

  it("fails when a mesh has no UV layer", () => {
    // A mesh without UVs cannot sample any baked map — it renders untextured
    // while every other statistic still looks correct.
    const c = check({ ...BASE_METADATA, stats: { ...BASE_METADATA.stats, uvMeshes: 12 } }, "uv-on-every-mesh");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("12/14");
  });

  it("fails when a required map is missing", () => {
    const withoutNormal = {
      ...BASE_METADATA,
      stats: {
        ...BASE_METADATA.stats,
        textures: BASE_METADATA.stats.textures!.filter((t) => !t.name.includes("normal")),
      },
    };
    const c = check(withoutNormal, "baked-maps-present");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("normal");
  });

  it("fails on a non-power-of-two or out-of-range texture size", () => {
    const odd = {
      ...BASE_METADATA,
      stats: { ...BASE_METADATA.stats, textures: [{ name: "vox_garment_basecolor", size: 3000 }] },
    };
    expect(check(odd, "texture-resolution")?.ok).toBe(false);

    const huge = {
      ...BASE_METADATA,
      stats: { ...BASE_METADATA.stats, textures: [{ name: "vox_garment_basecolor", size: 8192 }] },
    };
    expect(check(huge, "texture-resolution")?.ok).toBe(false);
  });

  it("stays silent about textures on an asset that declares none", () => {
    // The fields are optional so older bundles still validate — but an asset
    // that DOES declare them is held to them.
    const stats = { ...BASE_METADATA.stats };
    delete stats.textures;
    delete stats.uvMeshes;
    const report = validateAssetBundle(BASE_MANIFEST, { ...BASE_METADATA, stats }, "HERO");
    expect(report.checks.some((c) => c.id === "baked-maps-present")).toBe(false);
    expect(report.verdict).toBe("PASS");
  });

  it("parses the texture fields off a real metadata document", () => {
    const parsed = suitAssetMetadataSchema.parse(JSON.parse(JSON.stringify(BASE_METADATA)));
    expect(parsed.stats.textures).toHaveLength(6);
    expect(parsed.stats.uvMeshes).toBe(14);
    expect(suitAssetManifestSchema.parse(BASE_MANIFEST).files).toHaveLength(2);
  });
});
