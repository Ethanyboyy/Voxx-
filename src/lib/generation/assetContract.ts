import { z } from "zod";

/**
 * The suit asset contract.
 *
 * Until now `LabSuit.modelUrl` was a bare string pointing at a bare file, and
 * nothing recorded where that file came from, what was inside it, or whether
 * it was fit to render. That is exactly the gap where a fabricated asset would
 * slip through unnoticed — a .glb is opaque, and "it loaded" is not the same
 * claim as "it is what it says it is".
 *
 * So an asset is not a file, it is a bundle: the mesh, a manifest of the bytes
 * that make it up, and metadata recording provenance and real measured mesh
 * statistics. `validateAssetBundle()` is the gate between "a file exists" and
 * "this may be shown to the user as a real object".
 *
 * Layout, under public/models/suits/<suitId>/ :
 *
 *   suit.glb          the mesh itself
 *   manifest.json     every file in the bundle, with size and sha256
 *   metadata.json     provenance + measured mesh statistics
 *   preview.webp      still image for archive/list surfaces
 *   renders/          QA renders (turntable, detail passes)
 *   source/           the authoring script that produced this, verbatim
 *   qa/               the recorded validation report for this build
 *
 * The directory sits under /models/suits/ so it already satisfies the existing
 * validator in src/lib/validation/labSchemas.ts, which permits only paths
 * beginning "/models/suits/". No loosening of that rule was needed.
 */

/** Bumped when the bundle layout changes in a way older readers can't handle. */
export const ASSET_CONTRACT_VERSION = 1;

export const manifestFileSchema = z.object({
  /** Path relative to the bundle root, e.g. "suit.glb" or "renders/front.png". */
  path: z.string().min(1).max(200),
  bytes: z.number().int().nonnegative(),
  /** Lowercase hex sha256 of the file's contents. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const suitAssetManifestSchema = z.object({
  contractVersion: z.number().int().positive(),
  suitId: z.string().min(1),
  generatedAt: z.string(),
  files: z.array(manifestFileSchema).min(1),
});

/**
 * Real, measured properties of the mesh — read out of the built scene, never
 * guessed. If a field here cannot be measured it is absent, not filled in.
 */
export const meshStatsSchema = z.object({
  triangles: z.number().int().nonnegative(),
  vertices: z.number().int().nonnegative(),
  meshes: z.number().int().nonnegative(),
  materials: z.number().int().nonnegative(),
  /** Bounding box in metres, as authored. */
  heightM: z.number().nonnegative(),
  widthM: z.number().nonnegative(),
  depthM: z.number().nonnegative(),
  skinned: z.boolean(),
  /** Joint count when skinned; 0 otherwise. */
  joints: z.number().int().nonnegative(),
  /** True only if EVERY skinned mesh carries skinIndex AND skinWeight. */
  skinAttributesComplete: z.boolean(),
  /** Bone names, after the normalisation the runtime loader applies. */
  boneNames: z.array(z.string()).optional(),
});

export const suitAssetMetadataSchema = z.object({
  contractVersion: z.number().int().positive(),
  suitId: z.string().min(1),
  /** Which GenerationProvider produced this. */
  provider: z.string().min(1),
  /** The committed recipe/script name, so the build is reproducible. */
  recipe: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Attribution for anything not authored here. Required and non-empty —
   * an asset with no recorded origin does not ship.
   */
  provenance: z.object({
    origin: z.enum(["AUTHORED", "DERIVED", "THIRD_PARTY"]),
    /** Human description of where this came from. */
    description: z.string().min(1),
    license: z.string().min(1),
    sourceUrl: z.string().optional(),
  }),
  /** Up axis and facing axis as authored — the loader depends on both. */
  upAxis: z.enum(["Y", "Z"]),
  facingAxis: z.enum(["+Z", "-Z", "+X", "-X"]),
  stats: meshStatsSchema,
  generatedAt: z.string(),
  /** Measured build duration in milliseconds. */
  buildMs: z.number().nonnegative().optional(),
});

export type ManifestFile = z.infer<typeof manifestFileSchema>;
export type SuitAssetManifest = z.infer<typeof suitAssetManifestSchema>;
export type MeshStats = z.infer<typeof meshStatsSchema>;
export type SuitAssetMetadata = z.infer<typeof suitAssetMetadataSchema>;

/**
 * Delivery tiers.
 *
 * The Suit Bay runs on phones. A mesh that renders beautifully on a desktop
 * and blows the memory budget on a mid-range handset is not a good asset, it
 * is a broken one — so the budget is part of the contract rather than an
 * afterthought discovered in the field.
 *
 * Numbers are anchored to what this repository already ships: xbot.glb is
 * 2,930,032 bytes and ~49,100 triangles, and it renders acceptably on mobile
 * today. STANDARD is set around that known-good point; HERO allows roughly
 * triple for a single featured suit; MOBILE is the reduced variant.
 */
export type DeliveryTier = "MOBILE" | "STANDARD" | "HERO";

export interface TierBudget {
  maxTriangles: number;
  maxBytes: number;
  maxMaterials: number;
}

export const TIER_BUDGETS: Record<DeliveryTier, TierBudget> = {
  MOBILE: { maxTriangles: 30_000, maxBytes: 2_000_000, maxMaterials: 6 },
  STANDARD: { maxTriangles: 60_000, maxBytes: 4_000_000, maxMaterials: 12 },
  HERO: { maxTriangles: 180_000, maxBytes: 12_000_000, maxMaterials: 24 },
};

export interface QaCheck {
  id: string;
  ok: boolean;
  /** What was actually measured, so a failure is diagnosable from the report alone. */
  detail: string;
}

export interface QaReport {
  suitId: string;
  tier: DeliveryTier;
  verdict: "PASS" | "FAIL";
  checks: QaCheck[];
  checkedAt: string;
}

/**
 * Files every manifest must list.
 *
 * manifest.json is deliberately NOT here. A manifest cannot contain its own
 * checksum, so it excludes itself — requiring it would fail every bundle the
 * pipeline can actually produce. Its existence is implied by having a manifest
 * to validate at all.
 */
export const REQUIRED_BUNDLE_FILES = ["suit.glb", "metadata.json"] as const;

/**
 * The bone-name pattern the runtime loader normalises against.
 * Mirrors normalizeBoneName in poseBaking.ts — GLTFLoader rewrites
 * "mixamorig:Head" to "mixamorig_Head", so both separators must be accepted.
 */
const MIXAMO_BONE = /^mixamorig[:_]?(.+)$/i;

/** Joints the pose baker drives. A skinned suit missing these cannot be posed. */
export const REQUIRED_JOINTS = [
  "LeftArm",
  "RightArm",
  "LeftForeArm",
  "RightForeArm",
  "LeftHand",
  "RightHand",
  "LeftUpLeg",
  "RightUpLeg",
  "LeftLeg",
  "RightLeg",
] as const;

function normalizeBoneName(name: string): string {
  const m = MIXAMO_BONE.exec(name);
  return m ? m[1] : name;
}

/**
 * The gate. Returns PASS only when every check passes.
 *
 * This is intentionally strict and intentionally boring: each check maps to a
 * failure this pipeline has already produced at least once, or to a hard
 * requirement of the runtime loader documented in
 * docs/3d-pipeline/ARCHITECTURE.md §1.3.
 */
export function validateAssetBundle(
  manifest: SuitAssetManifest,
  metadata: SuitAssetMetadata,
  tier: DeliveryTier = "STANDARD",
): QaReport {
  const checks: QaCheck[] = [];
  const budget = TIER_BUDGETS[tier];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  // --- Bundle integrity -----------------------------------------------------
  add(
    "contract-version",
    manifest.contractVersion === ASSET_CONTRACT_VERSION && metadata.contractVersion === ASSET_CONTRACT_VERSION,
    `manifest v${manifest.contractVersion}, metadata v${metadata.contractVersion}, expected v${ASSET_CONTRACT_VERSION}`,
  );

  add(
    "suit-id-match",
    manifest.suitId === metadata.suitId,
    `manifest "${manifest.suitId}" vs metadata "${metadata.suitId}"`,
  );

  const paths = new Set(manifest.files.map((f) => f.path));
  const missing = REQUIRED_BUNDLE_FILES.filter((f) => !paths.has(f));
  add("required-files", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all present");

  const glb = manifest.files.find((f) => f.path === "suit.glb");
  add("glb-non-empty", !!glb && glb.bytes > 0, glb ? `${glb.bytes} bytes` : "suit.glb absent from manifest");

  // --- Provenance -----------------------------------------------------------
  // An asset with no recorded origin is exactly the thing this project's rules
  // exist to prevent, so this is a hard failure and not a warning.
  add(
    "provenance-recorded",
    metadata.provenance.description.trim().length > 0 && metadata.provenance.license.trim().length > 0,
    `${metadata.provenance.origin} · ${metadata.provenance.license}`,
  );

  add(
    "third-party-attributed",
    metadata.provenance.origin !== "THIRD_PARTY" || !!metadata.provenance.sourceUrl,
    metadata.provenance.origin === "THIRD_PARTY"
      ? `sourceUrl ${metadata.provenance.sourceUrl ? "present" : "MISSING"}`
      : "not third-party",
  );

  // --- Loader compatibility (ARCHITECTURE.md §1.3) --------------------------
  add("up-axis", metadata.upAxis === "Y", `authored ${metadata.upAxis}-up`);

  // Handedness: SuitArmor derives character-left as +X on the assumption the
  // body faces +Z. An asset facing any other way puts every mounted shell on
  // the wrong side of the body.
  add("facing-axis", metadata.facingAxis === "+Z", `faces ${metadata.facingAxis}`);

  const s = metadata.stats;

  add(
    "non-degenerate-bounds",
    s.heightM > 0 && s.widthM > 0 && s.depthM > 0,
    `${s.heightM.toFixed(3)} × ${s.widthM.toFixed(3)} × ${s.depthM.toFixed(3)} m`,
  );

  // The loader rescales to CANONICAL_BODY_HEIGHT, so absolute height is free —
  // but a figure whose height is not its longest axis is almost certainly
  // rotated wrong, and that reads as "lying down" in the viewer.
  add(
    "height-is-major-axis",
    s.heightM >= s.widthM && s.heightM >= s.depthM,
    `height ${s.heightM.toFixed(3)} vs width ${s.widthM.toFixed(3)}, depth ${s.depthM.toFixed(3)}`,
  );

  if (s.skinned) {
    // applyBoneTransform needs BOTH attributes. Guarding only skinIndex
    // produced silently wrong geometry once already.
    add("skin-attributes", s.skinAttributesComplete, "skinIndex and skinWeight required on every skinned mesh");
    add("has-joints", s.joints > 0, `${s.joints} joints`);

    const present = new Set((s.boneNames ?? []).map(normalizeBoneName));
    const absent = REQUIRED_JOINTS.filter((j) => !present.has(j));
    add(
      "poseable-skeleton",
      (s.boneNames?.length ?? 0) > 0 && absent.length === 0,
      absent.length ? `missing joints: ${absent.join(", ")}` : `${present.size} named joints`,
    );
  } else {
    add("static-mesh", true, "not skinned — mounted as static geometry");
  }

  // --- Delivery budget ------------------------------------------------------
  add(
    "triangle-budget",
    s.triangles > 0 && s.triangles <= budget.maxTriangles,
    `${s.triangles} tris, ${tier} budget ${budget.maxTriangles}`,
  );

  add(
    "byte-budget",
    !!glb && glb.bytes <= budget.maxBytes,
    `${glb?.bytes ?? 0} bytes, ${tier} budget ${budget.maxBytes}`,
  );

  add(
    "material-budget",
    s.materials > 0 && s.materials <= budget.maxMaterials,
    `${s.materials} materials, ${tier} budget ${budget.maxMaterials}`,
  );

  return {
    suitId: metadata.suitId,
    tier,
    verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL",
    checks,
    checkedAt: new Date().toISOString(),
  };
}

/** The public URL for a bundle's mesh — the value that goes in LabSuit.modelUrl. */
export function modelUrlForSuitAsset(suitId: string): string {
  return `/models/suits/${suitId}/suit.glb`;
}

/** Human-readable summary of a report, for logs and Event rows. */
export function summarizeQaReport(report: QaReport): string {
  const failed = report.checks.filter((c) => !c.ok);
  if (report.verdict === "PASS") return `PASS (${report.checks.length} checks, ${report.tier})`;
  return `FAIL: ${failed.map((c) => `${c.id} — ${c.detail}`).join("; ")}`;
}
