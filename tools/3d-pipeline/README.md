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
GENERATE  build_suit.py assembles the shell from anthropometric sections
INSPECT   measure_scene() reads real triangle/bounds/skin statistics
MODIFY    edit the section tables — they are the model's parameters
RENDER    ten Cycles QA views, including back, low and high angles
CRITIQUE  open the renders and look; this is not optional
VALIDATE  validateAssetBundle() in src/lib/generation/assetContract.ts
EXPORT    GLB + manifest.json + metadata.json + source/
```

**CRITIQUE is a real step.** Typecheck, lint and 412 tests all passed while
this pipeline was emitting a figure with no torso. Three defects in the current
build were found only by opening a render: overexposed lighting that flattened
every material to grey, limbs sitting beside the body as separate tubes, and a
boolean union that silently deleted the torso and head. None was visible to any
automated check.

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
- Blender is Z-up and exports Z-up → Y-up, mapping Blender `-Y` to glTF `+Z`.
  The figure is therefore built facing `-Y` so it faces `+Z` in the export,
  which is what the runtime armour rig assumes when it derives
  character-left as `+X`.

## Current state of the asset

The pipeline is complete and verified end to end. The mesh it produces is a
**continuous garment shell on correct anthropometry — a base, not a finished
flagship suit.** Known gaps, from looking at the renders: no hands or feet
definition, an undetailed head with no mask or lenses, no material zoning (all
three materials are authored but every face is on slot 0), and soft, heavy
proportions through the hips.

No suit's `LabSuit.modelUrl` points at this asset. It stays unwired until the
mesh is good enough to present as a real object, because a mediocre asset shown
as a real one is worse than the honest procedural render that is there today.
