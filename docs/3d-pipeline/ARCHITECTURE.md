# VOX 3D Pipeline — Architecture (existing state)

**Status of this document:** an audit of what the repository contained *before*
any 3D-pipeline infrastructure was added, plus the measured environment
constraints that any pipeline here has to live inside. Everything below was
read from the repository or measured in this container. Nothing is estimated.

Audit performed at commit `5b0cf53`, branch `claude/spider-man-lab-foundation-mvjayy`.

---

## 1. What already exists

### 1.1 The runtime renderer (browser, React Three Fiber)

The Suit Bay is a real WebGL viewer, not a picture. It lives in
`src/components/lab/three/` — 3,952 lines across 12 modules:

| Module | Lines | Role |
| --- | --- | --- |
| `HolographicSuitCanvas.tsx` | 321 | The `<Canvas>`: studio environment, projection platform, orbit controls, focus state, selection registry |
| `GltfSuitModel.tsx` | 477 | GLB loader → canonical normalization → pose baking → armour mounting |
| `SuitArmor.tsx` | 671 | Procedural armour shells mounted to skeleton joints; selection + hover |
| `SuitRig.tsx` | 479 | Fully procedural fallback body (error-boundary path only) |
| `poseBaking.ts` | 266 | CPU skin baking; kills the T-pose (see §1.3) |
| `suitConfig.ts` | 335 | `ArmorSlot` vocabulary, per-level loadouts, bulk/surface tables |
| `suitDesign.ts` | 262 | Emblem texture, design-parameter types |
| `WristSystem.tsx` | 218 | Web-shooter subcomponents — the drill-down's leaf level |
| `panelGeometry.ts` | 194 | `createShellPanel` / `createLensGeometry` / `createChamferedSlab` |
| `fabricTexture.ts` | 155 | Runtime-generated tileable weave/elastomer normal + roughness maps |
| `FocusRig.tsx` | 116 | Camera flight to measured world bounds |
| `canonicalBody.ts` | 17 | `CANONICAL_BODY_HEIGHT = 1.75`, `CANONICAL_FEET_Y = -1.3` |

Supporting service modules:

- `src/lib/lab/slotBridge.ts` (107 lines) — the closed table mapping all 18
  `ArmorSlot`s (plus mask/lensL/lensR) to `SlotSpec { assembly, componentName,
  function, manufacturing }`. This is what gives a clicked mesh a database identity.
- `src/lib/lab/drilldown.ts` (153 lines) — `FocusLevel = SUIT | ASSEMBLY |
  COMPONENT | SUBCOMPONENT`, one level per click, `breadcrumb()`, `idsToFrame()`.
- `src/lib/lab/cost.ts` (181 lines) — `PROCESS_MULTIPLIER` costing, with a
  `STORED | DERIVED | UNKNOWN` basis so a derived number can never masquerade
  as a recorded one.

**This layer is out of scope for modification.** It is the UX the pipeline
must feed, not a thing the pipeline replaces.

### 1.2 The asset contract as it stands today

`LabSuit.modelUrl` (`prisma/schema.prisma:1677`) is `String?`, validated in
`src/lib/validation/labSchemas.ts:111` by
`z.string().max(300).regex(/^\/models\/suits\//)`. So the *only* asset path
the application will accept today is a single file under
`/public/models/suits/`.

Contents of `/public/models/`:

| File | Size | Origin | License |
| --- | --- | --- | --- |
| `body/xbot.glb` | 2,930,032 B | three.js `examples/models/gltf/Xbot.glb` | MIT |
| `body/cesium-man.glb` | 438,044 B | Khronos glTF-Sample-Assets | CC-BY 4.0 |
| `suits/` | *empty* | — | — |

**Measured fact: `public/models/suits/` contains no asset.** Every suit in the
database has `modelUrl = NULL` and renders on `xbot.glb` (the default body,
`HolographicSuitCanvas.tsx:71`) with procedural armour mounted on top. There
is no bespoke suit mesh anywhere in this repository.

That single fact is the reason the Suit Bay cannot reach concept-art quality by
parameter tuning: there is no suit *geometry* to tune, only shells generated
from `ExtrudeGeometry` at runtime.

### 1.3 Constraints the existing renderer imposes on any new asset

These were learned the expensive way and any generated asset must respect them:

1. **Skinning is baked on the CPU.** `poseBaking.ts` calls
   `SkinnedMesh.applyBoneTransform` per vertex and swaps the `SkinnedMesh` for a
   plain `Mesh`. A `SkinnedMesh` needs *both* `skinIndex` and `skinWeight`
   attributes or the bake silently produces garbage.
2. **Geometry from `useGLTF` is cache-shared and must never be disposed.**
   `SkeletonUtils.clone()` shares buffers with the loader cache; freeing them
   breaks every later render of the same file.
3. **Handedness: the asset faces `+Z`, so character-left is `+X`.** Getting this
   backwards buried both arms inside the torso.
4. **Bone names are sanitised by `GLTFLoader`:** `mixamorig:Head` arrives as
   `mixamorig_Head`. `normalizeBoneName` accepts `/^mixamorig[:_]?(.+)$/i`.
5. **Normalization is measured, not assumed.** `normalizeToCanonicalBody()`
   measures the real bounding box, scales to `CANONICAL_BODY_HEIGHT`, seats the
   feet at `CANONICAL_FEET_Y`. Assets authored at any scale/origin are fine;
   assets with a non-Y-up root need a corrective rotation (see the CesiumMan case).
6. **Pose before measure.** Every downstream number is read from one `Box3`, and
   a T-posed body has a very different box from a posed one.

### 1.4 What does NOT exist

Verified absent by direct inspection:

- **No Blender integration of any kind.** No `blender` binary
  (`which blender` → empty), no `.blend` files, no addon, no export scripts.
- **No MCP configuration.** `claude mcp list` → *"No MCP servers configured."*
  No `.mcp.json` in the repository. `.claude/` is gitignored and holds only
  skills.
- **No generation-provider abstraction.** `src/lib/` has `ai/`, `research/`,
  `embeddings/`, `integrations/` — there is no `generation/`.
- **No asset manifest, metadata, QA, or provenance format.** `modelUrl` is a
  bare string; nothing records where a file came from, what it contains, or
  whether it is fit to ship.
- **No mesh-processing dependency.** `draco3d` and `meshoptimizer` are present
  in `node_modules` only as transitive dependencies of `three-stdlib`; nothing
  in `src/` imports them.

---

## 2. Measured environment constraints

Every line below is a real measurement taken in this container, not an
assumption. Outbound HTTPS goes through the agent proxy; a blocked host returns
`CONNECT tunnel failed, response 403`.

### 2.1 Network egress

| Host | Result |
| --- | --- |
| `pypi.org` | **200 — reachable** |
| `files.pythonhosted.org` | **200 — reachable** |
| `registry.npmjs.org` | **200 — reachable** |
| `github.com` | 400 (reachable; proxied git works) |
| `download.blender.org` | **403 — blocked** |
| `mirrors.ocf.berkeley.edu` | **403 — blocked** |
| `huggingface.co` | **403 — blocked** |
| `api.hyper3d.ai` | **403 — blocked** |
| `hyperhuman.deemos.com` | **403 — blocked** |
| `queue.fal.run` | **403 — blocked** |
| `api.sketchfab.com` | **403 — blocked** |
| `api.polyhaven.com` | **403 — blocked** |
| `api.poly.pizza` | **403 — blocked** |
| `platform.higgsfield.ai` | **403 — blocked** |

These are organizational egress controls. They are respected as-is — no
workaround, no proxy bypass, no TLS downgrade.

**The consequence is decisive:** every hosted 3D-generation service, every 3D
asset marketplace, and Blender's own download server are unreachable. Any
pipeline that depends on one of them cannot run here.

### 2.2 The opening this leaves

PyPI *is* reachable, and Blender ships its complete Python API to PyPI as the
`bpy` module. This was not assumed — it was installed and exercised:

- `bpy 5.0.1`, wheel `bpy-5.0.1-cp311-cp311-manylinux_2_28_x86_64.whl`,
  matching this container's Python 3.11.15.
- `import bpy` → `bpy.app.version_string = '5.0.1'`.
- **Verified end to end:** built a cylinder, applied `BEVEL` (0.03 / 3 segments)
  and `SUBSURF` (2 levels), authored a Principled BSDF (metallic 0.2, roughness
  0.35), added an area light and camera, rendered **Cycles / CPU / 24 samples /
  320×320 in 2.1 seconds**, and exported a 1,076,480-byte GLB via
  `bpy.ops.export_scene.gltf`. The render was inspected visually: correct
  shading, correct bevel, correct material.

So the full **GENERATE → INSPECT → MODIFY → RENDER → CRITIQUE → VALIDATE →
EXPORT** loop is available in this container, headless, offline after install,
and entirely within the egress policy.

Runtime cost note: 2.1 s at 320×320/24spp on CPU. Production QA renders at
higher resolution and sample counts scale roughly linearly in both — a
1024×1024/128spp turntable frame is on the order of a minute per frame, which
is a batch/offline cost, not an interactive one.

---

## 3. Where the pipeline attaches

The pipeline is **additive**. It does not modify the runtime renderer.

```
tools/3d-pipeline/          authoring — runs offline, under bpy, never shipped
  └── produces ─────────────► public/models/suits/<id>/suit.glb
                                                    manifest.json
                                                    metadata.json
                                                    qa/…
                              ▲
src/lib/generation/          the provider abstraction (mirrors src/lib/ai/)
                              │
prisma  LabSuit.modelUrl ─────┘  consumed unchanged by
src/components/lab/three/GltfSuitModel.tsx  ← UNTOUCHED
```

Two integration facts constrain the asset contract:

1. `labSchemas.ts` currently permits only `^/models/suits/`. A per-suit
   *directory* (`/models/suits/<id>/suit.glb`) satisfies that prefix, so the
   contract can be introduced without loosening the validator.
2. `GltfSuitModel` normalizes scale/origin itself, so an asset does not have to
   be authored at 1.75 m — but it *does* have to be Y-up, `+Z`-facing, and (if
   skinned) carry both skin attributes, per §1.3.

---

## 4. Open items this audit does not resolve

Recorded honestly rather than closed prematurely:

- The quality gap the user identified (reference concept art vs. current render)
  is a **geometry** gap. Procedural shells on a stock body cannot close it. It
  closes only when a real authored suit mesh exists at
  `public/models/suits/<id>/suit.glb`.
- `bpy` can *author and render* geometry deterministically from a script. It is
  not a generative model — it will not invent a sculpted character mesh from a
  text prompt. What it gives is a real, inspectable, scriptable modelling and
  rendering engine under version control.
- Every hosted generative 3D service is egress-blocked. The `GenerationProvider`
  abstraction is therefore written so a hosted provider can be added the day one
  becomes reachable, without any other code changing — but no such provider is
  enabled today, and none is faked.

---

*See `MCP_DECISIONS.md` for the MCP evaluation and the evidence behind it.*
