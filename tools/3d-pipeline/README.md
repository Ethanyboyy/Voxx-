# 3D authoring pipeline

Offline asset authoring for the Suit Bay. Nothing here runs in the web app or
ships to the browser — it produces the `.glb` bundles the app then loads.

## Setup

Blender is used as a **Python module**, not as an application. There is no GUI,
no `blender` binary, and no network access after install.

```bash
python3 -m venv .bpy
.bpy/bin/pip install bpy          # ~1 GB; needs Python 3.11 for bpy 5.0.x
export VOX_BLENDER_PYTHON="$PWD/.bpy/bin/python"
```

`bpy` wheels are built for one specific CPython version per release —
`bpy 5.0.1` is cp311. Check `pip index versions bpy` if your interpreter differs.

## Running a build

```bash
$VOX_BLENDER_PYTHON tools/3d-pipeline/build_suit.py \
    --suit-id mk-vii \
    --out-dir public/models/suits/mk-vii
```

Useful flags while iterating:

- `--skip-render` — geometry only. Builds in well under a second, so use this
  for anything that isn't a look check.
- `--views front,three_quarter` — render a subset instead of all ten.
- `--samples 32 --resolution 420` — fast preview quality.

Full ten-view output at default settings is a batch cost, not an interactive
one. Reference point measured on this container's CPU: three views at 32
samples / 420 px took about 10 seconds wall clock.

## The workflow

```
GENERATE  anatomy.py + body.py   skeleton graph → SKIN → subdivision
SCULPT    sculpt.py              muscle + facial displacement fields
GARMENT   garment.py             seams, mask, lenses
DEVICE    webshooter.py          five addressable mechanical parts
UNWRAP    meshops.unwrap         Smart UV Project on every mesh
TEXTURE   texturing.py           per-texel bake: zones, web, weave → PBR maps
RENDER    rendering.py           diagnostic rig, then cinematic
INSPECT   inspect_glb.py         what the EXPORTER actually produced
VALIDATE  src/lib/generation/assetContract.ts
```

**CRITIQUE is a real step.** Typecheck, lint and 418 tests all passed while this
pipeline emitted a figure with no torso, and later while every baked texture was
pure black. Neither was visible to any automated check.

### The texture stage

`texturing.py` rasterises the UV layout to recover a per-texel world position,
then evaluates the garment design analytically at texture resolution. This is
what fixed the boundary quantisation that made the previous asset
non-production: a panel edge is now a smoothstep over millimetres of real
surface, not a polygon edge.

It is written in Python rather than as shader nodes for one hard reason:
**Blender's procedural texture nodes do not survive glTF export.** A suit that
looks right in Cycles and arrives in the browser as flat colour is not a
delivered asset.

## Gotchas paid for already

- **A failed EXACT boolean does not raise — it empties the mesh.** `build_body()`
  now checks the polygon count after every union and fails loudly.
- **Rings must be perpendicular to the limb axis.** Horizontal rings on a
  diagonal limb self-intersect, and a self-intersecting operand makes the
  boolean return nothing.
- **Never bridge two identical sections.** Zero-area faces are degenerate input.
- **Union at base resolution, subdivide afterwards.** Subsurf then rounds the
  junction into a real shoulder/hip blend instead of leaving a hard crease.
- **`Object.shade_smooth()` does not exist on bpy 5.x** — use the operator.
- **Setting `image.colorspace_settings.name` ZEROES the pixel buffer.** Set the
  colorspace BEFORE writing pixels. Assigning it afterwards silently discarded
  every baked map for three consecutive builds while readbacks looked correct.
- **`float_buffer=False` images never reach the render/save buffer.**
  `pixels.foreach_set` reads back correctly via `foreach_get` and still saves an
  empty image. Always create bake targets with `float_buffer=True`.
- **Voronoi thresholds are in normalised cell units.** Real width is
  `threshold / scale` metres, so raising cell density silently shrinks the
  strand. Specify feature sizes in metres and convert.
- **Feature size is bounded from both ends by texel density and camera
  distance.** Too large reads as crazed glaze up close; too small goes
  sub-pixel and vanishes at hero framing.
- **`transform_apply(location=True)` moves the origin to (0, 0, 0).** Anything
  scaled afterwards therefore scales about the WORLD origin, not about itself.
  A 1.045 cutter scale on a part sitting at z = 1.62 displaced it 73 mm upward,
  where it intersected nothing — so the boolean was a silent no-op that still
  passed its own validation, and the lenses were never recessed at all.
- **EXACT-solver DIFFERENCE against the mask shell is unreliable in BOTH
  directions.** It deleted all 1840 faces for one cutter and changed nothing at
  all for a plain test cube, on a mesh with zero non-manifold edges and zero
  self-intersecting face pairs. Prefer interpenetrating opaque solids: two
  opaque objects already render as one set into the other, with no solver.
- **`recalc_face_normals` makes winding CONSISTENT, not outward.** On a shallow
  dished solid it settled on inside-out. `bm.calc_volume(signed=True) < 0` is
  the unambiguous test; flip on that rather than trusting the operator.
- **Deriving anything from a texture-space gradient is wrong.** Adjacent texels
  are usually metres apart on the body, because a UV island boundary lies
  between them. A seam taken as `np.gradient` of the zone masks drew a groove
  along the outline of every island — and since uncovered texels carry position
  (0, 0, 0), which the boot curve classifies as accent, each island was
  outlined against a solid accent field. Derive features analytically in WORLD
  space instead: a seam is the band around a zone weight's 50% line.
- **Mask uncovered texels before using them for anything.** See above.
- **Nyquist applies to baked detail.** The weave repeats every `2*pi/scale`
  metres; under about five texels it beats against the texel grid and renders
  as coarse diagonal corduroy. Measure the real texel size —
  `sqrt(mesh_area / covered_texels)` — and clamp the frequency to it. Detail
  finer than that belongs in ROUGHNESS, which degrades gracefully, not in the
  normal map, which does not.
- **Skin-modifier chain TERMINALS shrink far more than mid-chain nodes.** The
  heel's nominal underside was 6 mm and it built at 37 mm, so the figure stood
  on tiptoe in a permanent 3 cm heel rise. Nothing in the joint table shows
  this. Cast rays at the BUILT mesh and sweep the value until the measurement
  is right; nominal values below ground are fine and expected.
- **Never size a part from the joint table.** Same reason. The sole was written
  from the foot's widest section twice and came out 15-20 mm proud all round,
  because the foot has already narrowed by the time it reaches sole height.
  Measure the built surface, at several heights, and take the widest hit.
- **A loop projected onto a subdivided surface inherits its tessellation.** The
  lens rim rendered visibly dented; the sole outline had a step where the
  extrapolated toe met the measured stations. Low-pass the closed loop
  (`garment._smooth_ring`) — a few tenths of a millimetre of fit for a clean
  designed curve.
- **A feature only reads by CONTRAST with its surroundings.** Scaling every
  facial field up together produced swollen cheeks and no more nose than
  before. Hold the neighbours back and raise the one feature.
- Blender is Z-up and exports Z-up → Y-up, mapping Blender `-Y` to glTF `+Z`.
  The figure is therefore built facing `-Y` so it faces `+Z` in the export,
  which is what the runtime armour rig assumes when it derives
  character-left as `+X`.

## Current state of the asset

See `docs/3d-pipeline/MASTER_SUIT_STATUS.md` for the full gate assessment.

Short version: the suit is a continuous garment on real anthropometry with
defined hands, feet, a fitted mask, recessed lenses, a mounted five-part
web-shooter, eight assigned materials and carved seams. It passes every gate
category except **Garment**, which fails because the web pattern is not
implemented.

That failure and the remaining softness both trace to one absent stage: baked
texture maps. Material zones are assigned per FACE, so panel boundaries quantise
to ~1 cm polygons and cannot read as cut edges; and Blender's procedural weave
nodes do not survive glTF export at all. UV unwrap is done (all 14 meshes carry
TEXCOORD_0), so the next pass is generating image maps in UV space and assigning
them — no new dependency, no change to any geometry module.

`LabSuit.modelUrl` is deliberately NOT pointed at this asset. The gate is
all-or-nothing by its own terms, and shipping a near-miss as production would be
exactly the fabrication the asset contract exists to prevent.
