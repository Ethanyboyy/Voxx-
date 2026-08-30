import { z } from "zod";
import { assetDefinitionSchema, registerAsset, type AssetDefinition, type AssetKind } from "@/lib/3d/assetRegistry";

/**
 * Discovery: how an externally produced GLB gets into the application without
 * anyone editing a component.
 *
 * The contract is a directory layout under `public/models/`:
 *
 * ```
 * public/models/
 *   index.json                     ← lists every asset manifest
 *   suits/
 *     hero-v1/
 *       asset.json                 ← an AssetDefinition (see assetRegistry.ts)
 *       hero-v1.hero.glb
 *       hero-v1.mobile.glb
 *       preview.webp
 * ```
 *
 * Adding an asset is: drop the folder in, add one line to `index.json`. No
 * component knows the file name, the triangle count, or which LOD a phone gets
 * — those are facts about the asset, so they live with the asset.
 *
 * Nothing here invents data. A manifest that fails validation is rejected with
 * the reason, and the caller renders whatever fallback it has. An asset that
 * claims a mesh it doesn't contain is caught at load time by AssetModel, not
 * papered over.
 */

export const ASSET_INDEX_URL = "/models/index.json";

/**
 * A manifest path must live under /models/ AND contain no `..` segment.
 *
 * The prefix check alone is not enough: `/models/../secrets.json` starts with
 * `/models/` and is still an escape. Two separate conditions, because one of
 * them is easy to believe covers the other.
 */
const MANIFEST_PATH = /^\/models\/[\w./-]+\.json$/;

export function isSafeManifestPath(path: string): boolean {
  if (!MANIFEST_PATH.test(path)) return false;
  return !path.split("/").includes("..");
}

export const assetIndexSchema = z.object({
  /** Manifest paths, each under /models/ and ending in .json. */
  assets: z
    .array(z.string().refine(isSafeManifestPath, "manifest paths must be /models/**.json with no '..' segment"))
    .default([]),
});

export type AssetIndex = z.infer<typeof assetIndexSchema>;

/** Conventional manifest location for an asset, if a caller wants to skip the index. */
export function assetManifestUrl(kind: AssetKind, assetId: string): string {
  return `/models/${kind}s/${assetId}/asset.json`;
}

type FetchLike = (input: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Loads and registers one manifest.
 *
 * Registration is the side effect that makes the asset renderable, and it only
 * happens after Zod has accepted the document — a half-valid manifest never
 * reaches the scene graph.
 */
export async function loadAssetDefinition(url: string, fetchImpl?: FetchLike): Promise<AssetDefinition> {
  if (!isSafeManifestPath(url)) {
    throw new Error(`refusing to load asset manifest from outside /models/: ${url}`);
  }
  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  const response = await doFetch(url);
  if (!response.ok) throw new Error(`asset manifest ${url} returned ${response.status}`);
  const parsed = assetDefinitionSchema.parse(await response.json());
  registerAsset(parsed);
  return parsed;
}

export interface AssetIndexResult {
  loaded: AssetDefinition[];
  /** Manifests that failed, with why. Surfaced, never swallowed. */
  failed: Array<{ url: string; reason: string }>;
}

/**
 * Loads every manifest named by the index.
 *
 * A missing index is not an error — it is the current, honest state of a
 * project with no external assets yet, and it returns an empty result rather
 * than throwing into a render tree.
 */
export async function loadAssetIndex(fetchImpl?: FetchLike): Promise<AssetIndexResult> {
  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  let index: AssetIndex;
  try {
    const response = await doFetch(ASSET_INDEX_URL);
    if (!response.ok) return { loaded: [], failed: [] };
    index = assetIndexSchema.parse(await response.json());
  } catch {
    return { loaded: [], failed: [] };
  }

  const loaded: AssetDefinition[] = [];
  const failed: AssetIndexResult["failed"] = [];
  for (const url of index.assets) {
    try {
      loaded.push(await loadAssetDefinition(url, doFetch));
    } catch (error) {
      failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { loaded, failed };
}
