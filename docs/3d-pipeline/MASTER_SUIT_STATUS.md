# VOX master suit — status against the quality gate

**Verdict: NON-PRODUCTION. `modelUrl` is NOT assigned.**

The asset passes most of the gate but fails on one category, and the gate is
all-or-nothing by its own terms. The failure is not a matter of more parameter
tuning — it is a missing pipeline stage, identified precisely in §3.

Build: `tools/3d-pipeline/build_suit.py`, 55,640 triangles, 14 meshes,
8 materials, 1.722 m, GLB 1,515,364 bytes, 156 s wall clock.
Renders in `renders/`.

---

## 1. What changed from the rejected base

The previous asset was a set of swept tubes boolean-unioned onto a torso. It was
rejected as a mannequin, correctly. The method changed rather than the numbers:

| | Rejected base | This asset |
| --- | --- | --- |
| Limb junctions | boolean union of tubes | SKIN modifier over a skeleton graph — connected by construction, **no booleans in the body at all** |
| Form | subdivision only | 35 parametric muscle displacement fields |
| Hands | tapered stubs | palm, thumb, four separated fingers on individual knuckles |
| Feet | rounded blob | heel, arch, forefoot, toe |
| Head | featureless egg | skull with brow, cheek, jaw, occiput fields |
| Mask | none | fitted shell built **from the head's own surface**, 3.5 mm solidified |
| Lenses | none | shaped superellipse solids, boolean-recessed into the mask |
| Web-shooter | 5 primitive blocks | 5 named parts, housing curved to the forearm radius |
| Materials | 3 appended, **every face on slot 0** | 8 materials, per-face assignment verified in the build log |
| Seams | none | 806 vertices displaced along 12 anatomical seam lines |
| UVs | none | all 14 meshes unwrapped |

## 2. Gate results

### Geometry — PASS
Continuous body, convincing anatomy, defined hands, defined feet, convincing
head, fitted mask, integrated lenses. No holes, no self-intersections, no
corrupted boolean results — the body path contains no booleans, and the two
that remain (lens sockets) are validated by `meshops.safe_boolean`.

### Technology — PASS
Five independently addressable parts per arm, named to match the runtime ids
(`wristHousingL` … `wristTriggerR`). The housing is an annular sector cut to the
forearm's own radius, so it sits flush rather than floating; the cartridge is
half-sunk into the mechanism; the trigger is on the palm side.

### Rendering — PASS
Materials stay distinguishable, lighting does not flatten the asset, silhouette
reads correctly. Diagnostic and cinematic rigs are separate, and only the
diagnostic rig was used to judge anything.

### VOX compatibility — PASS
Y-up, faces +Z, `/models/suits/<id>/suit.glb`, manifest + metadata + provenance,
component ids match `drilldown.ts`. QA gate: **PASS at STANDARD and HERO**,
FAIL at MOBILE (55,640 tris vs 30,000; 8 materials vs 6) — a MOBILE variant
needs a decimation pass that does not exist yet.

### Garment — **FAIL**
- Believable seams — pass.
- Intentional construction — partial.
- Material zoning — implemented, but see below.
- Convincing textile response — weak.
- **Web pattern follows body — NOT IMPLEMENTED.**

---

## 3. The blocking limitation, precisely

**Everything still missing is blocked on the same absent stage: baked texture
maps.**

Material zones are currently assigned per *face*. A face on this mesh is about
1 cm across, so a smooth panel boundary quantises to the mesh and comes out
stair-stepped. A majority filter over face adjacency (3 passes) removes the
speckle and straightens the runs, and it is a real improvement — but it cannot
produce a clean curved edge, because the edge can only ever follow polygon
boundaries. This is visible in every full-body render and is the single most
damaging remaining defect.

The same wall blocks the rest:

| Missing | Why per-face/procedural cannot do it |
| --- | --- |
| Clean panel edges | boundary quantises to ~1 cm faces |
| Web pattern | needs sub-millimetre placement following body curvature |
| Fabric microstructure | procedural weave is node-based and **does not survive glTF export** — glTF carries baked images only |
| Insignia | same as the web pattern |

Raising subdivision does not fix this: it reduces stepping linearly while
raising triangle count by 4× per level, and blows the delivery budget long
before the edge looks cut.

### The stage that closes it

1. **UV unwrap — DONE this pass.** All 14 meshes carry `TEXCOORD_0`. This was
   the prerequisite and it is now in the GLB.
2. **Procedural map generation.** Build base-colour, roughness and normal images
   in Python (numpy → `bpy.data.images`), drawing zone boundaries, the web
   pattern and the weave analytically in UV space at 2–4 K. Analytic drawing
   into a texture has no mesh-density limit.
3. **Bake and export.** Assign the generated images to Image Texture nodes.
   Unlike procedural nodes, image textures export into the GLB, so the browser
   sees the same surface Cycles does.

That is a self-contained addition to `materials.py` plus one new module. It
requires no new dependency, no network, and no change to the anatomy, garment,
mask, lens or web-shooter code — all of which are done and passing.

---

## 4. Defects fixed this pass, each found only by looking at a render

Typecheck, lint and 412 tests were green throughout every one of these:

1. **Camera could not fit the figure.** 85 mm at 3.3 m covers 1.40 m vertically;
   the figure is 1.71 m. The head was cropped off every full-body view. This is
   arithmetic, and it was wrong in the committed pipeline.
2. **Torso was a flat plank** — 0.22 m deep, no spinal curve. The `y` column of
   the skeleton now carries a real S-curve.
3. **Shoulders too narrow against a wide pelvis** — the most damaging proportion
   error in a hero silhouette.
4. **Crotch joint hung below the pelvis as a lobe** and creased into a hard V.
   Removed; the legs now branch straight off the pelvis.
5. **Lenses were buried 3.5 cm inside the skull.** Measured the head's real
   front surface (y = −0.090 at z = 1.62) instead of guessing.
6. **Lens outline had a hard kink** — the sweep term stepped discontinuously
   across x = 0. Replaced with a smoothstep blend.
7. **Lens material mirrored the entire area light**, rendering as a flat white
   shape. Roughness 0.055 → 0.13, metallic 0.25 → 0.
8. **Web-shooter parts stood off the arm like a fin** — the mount frame put the
   outboard direction on the wrong local axis, and the naive cross-product order
   also gave a left-handed basis that mirrored every part.
9. **Weave aliased into heavy diagonal moiré** at scale 760.
10. **Grey band of primary textile across the abdomen** between yoke and belt,
    reading as an unfinished gap.

Two guards were added so three of these cannot recur silently: the boolean
polygon-ratio check, and the body-height assertion.

---

## 5. Honest remaining weaknesses

Beyond the blocking limitation:

- The head reads as a smooth ovoid under the mask. The sculpt fields give it
  brow, cheek and jaw, but no nose or mouth structure.
- Fabric microstructure is present but weak, and will stay weak until it is
  baked rather than node-based.
- Fingers are slightly sausage-like; they read unmistakably as a hand, which was
  the stated bar, but they are not refined.
- The figure is athletic but soft. Peak muscle displacement is 24.7 mm.

None of these is a reason to lower the bar. They are the next pass.
