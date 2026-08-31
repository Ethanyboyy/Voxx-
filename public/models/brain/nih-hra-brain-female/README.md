# NIH HRA Brain (Female) — 3DPX-020959

**The GLB is NOT in this repository.** It could not be downloaded from the
session that scaffolded this directory: the environment's egress policy denies
`3d.nih.gov` (the proxy answers 403 to CONNECT). Fetching the same model from a
mirror was rejected deliberately — it would route around that policy and would
also mean bundling a file whose version and licence could not be verified
against the authoritative entry.

## To complete the integration

1. Download the **current v1.3 GLB** from <https://3d.nih.gov/entries/20959>.
2. Save it here as `brain.hero.glb`.
3. Run the inspector, which measures the real file rather than assuming
   anything about it:

   ```
   npx tsx tools/3d-pipeline/inspect_glb.ts public/models/brain/nih-hra-brain-female/brain.hero.glb
   ```

   It prints mesh count, vertex/triangle totals, bounding box, materials,
   textures and the full node hierarchy.
4. Fill the measured `bytes` and `triangles` into `asset.json`, and confirm
   `provenance` still matches what the NIH entry states **today** — version and
   licence on that page can change, and this file records what was true when it
   was written, not a guarantee.
5. Add the manifest to `public/models/index.json`:

   ```json
   { "assets": ["/models/suits/vx-01-meridian/asset.json",
                "/models/brain/nih-hra-brain-female/asset.json"] }
   ```
6. If the hierarchy exposes the individual anatomical structures as named
   nodes, map them into `asset.json`'s `components[]` using `meshNames` — that
   is the existing bridge from a third-party GLB's own naming to VOX semantic
   ids, and it is what makes per-structure selection work without touching any
   component code.

Nothing else needs changing: `BrainMesh` already renders a registered `brain`
asset in place of the procedural cortex and falls back when none is registered.

## Licence

Creative Commons Attribution 4.0 International (CC BY 4.0).

**This is not public domain.** CC BY 4.0 requires attribution wherever the
model is displayed. `src/components/brain/three/AssetAttribution.tsx` renders it
in the Brain workspace, and it renders only while the asset is actually loaded —
do not remove it, and do not display the model without it.
