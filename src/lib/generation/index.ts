import { BlenderLocalProvider } from "@/lib/generation/blenderLocal";
import { UnavailableGenerationProvider } from "@/lib/generation/unavailable";
import type { GenerationProvider } from "@/lib/generation/types";

export type {
  GenerationCapability,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
} from "@/lib/generation/types";

export {
  ASSET_CONTRACT_VERSION,
  REQUIRED_BUNDLE_FILES,
  REQUIRED_JOINTS,
  TIER_BUDGETS,
  modelUrlForSuitAsset,
  summarizeQaReport,
  suitAssetManifestSchema,
  suitAssetMetadataSchema,
  validateAssetBundle,
} from "@/lib/generation/assetContract";
export type {
  DeliveryTier,
  MeshStats,
  QaCheck,
  QaReport,
  SuitAssetManifest,
  SuitAssetMetadata,
  TierBudget,
} from "@/lib/generation/assetContract";

let cached: GenerationProvider | null = null;

/**
 * Resolves the active 3D generation provider.
 *
 * Local Blender when `VOX_BLENDER_PYTHON` names an interpreter that has `bpy`
 * installed; otherwise an explicitly unavailable provider that says why.
 *
 * Unlike getAIProvider(), there is no mock fallback — see
 * UnavailableGenerationProvider for why a fake 3D asset is a different class of
 * problem from a fake text completion.
 *
 * A remote provider (Higgsfield, Rodin, a self-hosted Hunyuan3D) would be added
 * here gated on its own env var, absent by default, per CLAUDE.md rule 6. None
 * is reachable from this environment today — see
 * docs/3d-pipeline/MCP_DECISIONS.md.
 */
export function getGenerationProvider(): GenerationProvider {
  if (cached) return cached;

  const blender = new BlenderLocalProvider(process.env.VOX_BLENDER_PYTHON ?? null);
  cached = blender.isConfigured
    ? blender
    : new UnavailableGenerationProvider(blender.unavailableReason ?? "no provider configured");
  return cached;
}

/** Test-only hook to reset the cached provider between specs. */
export function _resetGenerationProviderCache(): void {
  cached = null;
}
