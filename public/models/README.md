# External 3D assets

This is the drop-in point for 3D assets produced **outside** this repository —
by a commissioned artist, an AI generation service, a marketplace, or the
Blender pipeline in `tools/3d-pipeline/`.

No component in `src/` names a file in here. The application asks the registry
for an asset and renders whatever is registered, including the case where
nothing is. Importing a better asset is therefore a data change, not a code
change.

## Directory layout

```
public/models/
  index.json                  ← lists every asset manifest (the only file the app fetches by name)
  suits/
    hero-v1/
      asset.json              ← the manifest; schema: src/lib/3d/assetRegistry.ts
      hero-v1.hero.glb
      hero-v1.mobile.glb
      preview.webp
  body/                       ← existing third-party test bodies (see body/README.md)
```

`kind` in the manifest determines the folder: `suit` → `suits/`, `gadget` →
`gadgets/`, `character` → `characters/`, and so on.

## Importing an asset — the whole procedure

1. Export a `.glb` with **+Y up**, metres, and the origin between the feet.
   Embed textures in the file (`.glb`, not `.gltf` + folder).
2. Create `public/models/<kind>s/<asset-id>/` and put the file(s) in it. Ship at
   least a `HIGH` LOD; a `MOBILE` LOD under ~4 MB is strongly preferred, because
   `resolveLod()` will otherwise hand a phone the heavy file rather than nothing.
3. Write `asset.json` (see the example below).
4. Add its path to `index.json`'s `assets` array.
5. Reload. `loadAssetIndex()` validates and registers it; `<AssetModel>` renders
   it, `<Materialize>` reveals it, and every component listed in `components`
   becomes selectable, focusable and inspectable.

Nothing else needs to change. If the manifest names a mesh the file does not
contain, that part is reported through `onMissingMeshes` and left
non-interactive — it is never silently matched to different geometry.

## `asset.json`

```json
{
  "assetId": "hero-v1",
  "kind": "suit",
  "label": "Hero Suit Mk I",
  "lods": [
    { "url": "/models/suits/hero-v1/hero-v1.hero.glb", "tier": "HERO", "bytes": 24117248, "triangles": 180000 },
    { "url": "/models/suits/hero-v1/hero-v1.mobile.glb", "tier": "MOBILE", "bytes": 3145728, "triangles": 28000 }
  ],
  "components": [
    { "id": "mask", "label": "Mask", "parentId": null, "meshNames": ["Mask_LP"], "detachable": true },
    { "id": "lens-l", "label": "Left Lens", "parentId": "mask", "meshNames": ["Lens_L"] }
  ],
  "preview": "/models/suits/hero-v1/preview.webp",
  "provenance": {
    "origin": "THIRD_PARTY",
    "description": "Who made it, how, and when.",
    "license": "The actual licence terms.",
    "sourceUrl": "https://…"
  },
  "animations": []
}
```

`provenance` is **required**. An asset whose origin and licence are unknown does
not ship — that is a licensing rule, not a style preference.

## Do not commit large binaries casually

A GLB over a few MB belongs in Git LFS or object storage with a URL, not in a
normal commit.
