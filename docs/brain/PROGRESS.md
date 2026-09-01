# Brain visualization — progress

Updated at the commit that added the asset-path guards. Read `BRAIN_VISUAL_ENGINE.md`
for the architecture; this file is only current state, and it is kept short on purpose.

## Current implementation

`/brain` → `BrainRouteClient` → `VoxBrain3D` (3D is the default; the 2D
`BrainWorkspace` survives as "Structural View", and is also the automatic
fallback when WebGL is unavailable).

`VoxBrain3D` holds view state only. Domain and event state live in
`useBrainVisualState` — live graph, SSE event stream, signal classification,
per-system pulses — so the renderer can be replaced without touching the data.

`BrainMesh` renders **one of two cortices**:

| Condition | What renders |
|---|---|
| A `brain` asset is registered | `AnatomicalBrainAsset` (GLB via `useGLTF`) |
| No asset registered | Procedural cortex (`brainGeometry.ts`) |
| Asset registered but still downloading | Procedural cortex, via `<Suspense>` |
| Asset registered but 404s / fails to parse | Procedural cortex, via `GltfErrorBoundary` |

## Asset

**There is no GLB in this repository.** `public/models/brain/nih-hra-brain-female/`
holds only `asset.json` (provenance) and `README.md` (completion steps).

Chosen asset: NIH 3D **3DPX-020959** "Brain, Female", v1.3 GLB,
**CC BY 4.0 — not public domain**, <https://3d.nih.gov/entries/20959>.

Blocked: this environment's egress policy denies `3d.nih.gov` (proxy returns 403
to CONNECT). A mirror was rejected deliberately — it routes around that policy
and would mean bundling a file whose version and licence cannot be verified
against the authoritative entry. Resolution is the owner's: allowlist the host,
or drop the file at `brain.hero.glb`.

Because the file is absent, **every asset statistic is unmeasured**: size, mesh
count, vertices, triangles, materials, textures, bounding box, whether Draco or
Meshopt is used, and whether the 141 structures are individually addressable.
`tools/3d-pipeline/inspect_glb.ts` measures all of it in one run. Do not guess
these values; do not size a mobile LOD before measuring.

## Completed

- Asset slot wired end to end, reusing the Suit Bay's registry/loader — no second pipeline.
- Asset self-normalises to the procedural mesh's bounds (centred, longest axis 1.9), so camera framing, region anchors, clip planes and satellite layout need no per-asset recalibration.
- Clipping planes, state emissive colour and X-ray opacity applied to the asset's own cloned materials, so CUTAWAY and X-RAY will work on the GLB.
- Suspense + error boundary, both falling back to the procedural cortex. Verified in a browser by registering an asset pointing at a missing file: canvas and toolbar survive, zero uncaught errors, 0px overflow at 390px.
- CC BY 4.0 attribution surface, registry-driven, renders nothing when no third-party asset is registered.
- GPU lifecycle audited; per-frame `Vector3` allocations removed from `BrainMesh` and `EntitySatellite`.
- Deterministic activity-intensity model (`lib/brain/intensity.ts`, 17 tests).

## Known limitations

- **The rendered Brain is the procedural fallback and does not read convincingly as human anatomy.** This is the headline gap. Procedural generation was tried to its reasonable limit and rejected: gyri are ribbons with coherent global topology, and noise on a sphere produces bumps with none. Do not reopen it.
- Per-structure anatomical selection is designed but unimplemented — it needs the GLB's real node names.
- `getBrainState()` does not read `CapabilityRun` or the iteration loop, so a chat-started run reaches the Brain only as a generic `executing`. `intensity.ts` exists to close this but is not yet wired into the visualization.
- No DOM test tooling, so mount/unmount subscription behaviour is enforced by review, not tests.

## Next task

Get the GLB in, then **inspect before integrating**:

```
npx tsx tools/3d-pipeline/inspect_glb.ts public/models/brain/nih-hra-brain-female/brain.hero.glb
```

Report those numbers, then fill `asset.json`, register in `public/models/index.json`,
map real node names into `components[].meshNames`, and verify against the anatomical
acceptance test — would someone with no context call it a human brain?
