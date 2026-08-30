import { z } from "zod";

/**
 * The contract for EXTERNAL 3D assets — the drop-in point for a hero GLB
 * produced anywhere: an AI generation service, a commissioned artist, a
 * marketplace, or this repository's own Blender pipeline.
 *
 * The whole point is that dropping in a better asset must not require
 * redesigning the application. So the UI never names a file. It asks the
 * registry for an asset by id and renders whatever is registered, including
 * the case where nothing is — which is the state everything is in today.
 *
 * This deliberately does NOT replace `src/lib/generation/assetContract.ts`.
 * That module validates a bundle PRODUCED by the Blender pipeline, with
 * provenance and measured mesh statistics. This one describes what the RUNTIME
 * needs in order to load, tier and interact with an asset, whoever made it.
 */

export type AssetKind = "suit" | "brain" | "gadget" | "lab" | "environment" | "character";

/** Delivery tiers, mirroring src/lib/3d/quality.ts. */
export const assetLodSchema = z.object({
  /** Public URL under /models/. */
  url: z.string().regex(/^\/models\//, "asset urls must live under /models/"),
  /** Which quality tier this file is intended for. */
  tier: z.enum(["MOBILE", "MEDIUM", "HIGH", "HERO"]),
  /** File size in bytes, for budgeting and load-time estimation. */
  bytes: z.number().int().positive().optional(),
  triangles: z.number().int().positive().optional(),
});

/**
 * A named, interactive part of an asset.
 *
 * `meshNames` is the bridge between the GLB's own node names and VOX's
 * semantic ids. Externally generated assets will not use VOX's naming, so the
 * mapping lives in data rather than being hardcoded — that is what makes a
 * third-party mesh inspectable without editing components.
 */
export const assetComponentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  parentId: z.string().nullable().default(null),
  kind: z.string().optional(),
  /** Node names inside the GLB that make up this component. */
  meshNames: z.array(z.string()).default([]),
  interactive: z.boolean().default(true),
  inspectable: z.boolean().default(true),
  detachable: z.boolean().default(false),
  /** Free-form facts surfaced in the inspector. Never invented by the loader. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const assetDefinitionSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(["suit", "brain", "gadget", "lab", "environment", "character"]),
  label: z.string().min(1),
  /** At least one LOD. The runtime picks by tier and falls back downward. */
  lods: z.array(assetLodSchema).min(1),
  components: z.array(assetComponentSchema).default([]),
  /** Still image for list/archive surfaces. */
  preview: z.string().optional(),
  /** Where this came from. Required — an unattributed asset does not ship. */
  provenance: z.object({
    origin: z.enum(["AUTHORED", "GENERATED", "THIRD_PARTY", "PROCEDURAL"]),
    description: z.string().min(1),
    license: z.string().min(1),
    sourceUrl: z.string().optional(),
  }),
  /** Animation clip names present in the file, if any. */
  animations: z.array(z.string()).default([]),
});

export type AssetLod = z.infer<typeof assetLodSchema>;
export type AssetComponent = z.infer<typeof assetComponentSchema>;
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;

export type QualityTierName = AssetLod["tier"];

/** Tiers in descending cost, used for fallback resolution. */
const TIER_ORDER: QualityTierName[] = ["HERO", "HIGH", "MEDIUM", "MOBILE"];

/**
 * Picks the best LOD a device can afford.
 *
 * Resolution walks DOWN from the requested tier first (cheaper is always
 * acceptable), and only then upward. A phone handed an asset that ships a HERO
 * file alone should still get something rather than nothing — a blank canvas is
 * a worse failure than a heavy download.
 */
export function resolveLod(asset: AssetDefinition, tier: QualityTierName): AssetLod | null {
  if (asset.lods.length === 0) return null;
  const start = TIER_ORDER.indexOf(tier);
  const order = start === -1 ? TIER_ORDER : [...TIER_ORDER.slice(start), ...TIER_ORDER.slice(0, start).reverse()];
  for (const candidate of order) {
    const match = asset.lods.find((l) => l.tier === candidate);
    if (match) return match;
  }
  return asset.lods[0];
}

/**
 * The registry.
 *
 * Empty by default and that is the honest state: no externally generated hero
 * asset exists yet. Surfaces must render a real fallback when `get` returns
 * null rather than assuming an asset is present.
 */
const registry = new Map<string, AssetDefinition>();

export function registerAsset(definition: unknown): AssetDefinition {
  const parsed = assetDefinitionSchema.parse(definition);
  registry.set(parsed.assetId, parsed);
  return parsed;
}

export function getAsset(assetId: string): AssetDefinition | null {
  return registry.get(assetId) ?? null;
}

export function listAssets(kind?: AssetKind): AssetDefinition[] {
  const all = [...registry.values()];
  return kind ? all.filter((a) => a.kind === kind) : all;
}

export function clearRegistry(): void {
  registry.clear();
}

/**
 * Turns an asset's components into the node list the interaction framework
 * consumes, so an external GLB becomes drillable purely from its manifest.
 */
export function componentsToNodes(asset: AssetDefinition) {
  return asset.components.map((component) => ({
    id: component.id,
    label: component.label,
    parentId: component.parentId,
    kind: component.kind,
  }));
}

/** Maps a GLB node name back to the VOX component that owns it. */
export function componentForMesh(asset: AssetDefinition, meshName: string): AssetComponent | null {
  return asset.components.find((c) => c.meshNames.includes(meshName)) ?? null;
}
