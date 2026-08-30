"""Authoring recipe: the VOX master suit.

Run under a Python that has `bpy` installed (pip install bpy). This is Blender
itself as a library — no Blender application, no GUI, no network.

    $VOX_BLENDER_PYTHON tools/3d-pipeline/build_suit.py \
        --suit-id vox-master --out-dir public/models/suits/vox-master

Pipeline, in the order the quality brief requires:

    anatomy      body.py       skeleton graph → SKIN → subdivision
    silhouette   anatomy.py    proportions, elliptical per-joint radii
    form         sculpt.py     muscle displacement fields
    garment      garment.py    seams, material zones
    head/mask    garment.py    fitted mask from the head's own surface
    lenses       garment.py    shaped solids, recessed into the mask
    technology   webshooter.py five addressable mechanical parts
    materials    materials.py  seven distinct materials
    render       rendering.py  diagnostic rig first, cinematic last

Every stage validates its own output — see meshops.py for why nothing here
trusts an operator's return.
"""

import argparse
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import body            # noqa: E402
import garment         # noqa: E402
import materials       # noqa: E402
import meshops         # noqa: E402
import rendering       # noqa: E402
import sculpt          # noqa: E402
import webshooter      # noqa: E402
from contract import measure_scene, write_bundle  # noqa: E402

DIAGNOSTIC_VIEWS = ["front", "side", "rear", "three_quarter", "head", "mask_lens", "web_shooter", "hand", "foot", "torso"]

#: Which material each mechanical part carries.
PART_MATERIAL = {
    "Housing": "POLYMER",
    "Mechanism": "METAL",
    "Cartridge": "CARTRIDGE",
    "Nozzle": "METAL",
    "Trigger": "POLYMER",
}


def build(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    log = {}

    # --- 1-3: anatomy, silhouette, continuous garment construction ----------
    suit = body.build_body(subdivisions=args.subdivisions)
    log["body"] = meshops.describe(suit)

    log["sculpt"] = sculpt.apply_muscles(suit, scale=args.sculpt)
    sculpt.relax(suit, iterations=1, factor=0.25)

    # --- 9: seams ------------------------------------------------------------
    log["seams"] = garment.carve_seams(suit)

    # --- 14: material zoning -------------------------------------------------
    mats = materials.build_materials()
    for role in garment.ZONE_SLOTS:
        suit.data.materials.append(mats[role])
    log["zones"] = garment.assign_zones(suit)
    meshops.shade_smooth(suit, 60)

    # --- 6-8: head, mask, lenses --------------------------------------------
    mask = garment.build_mask(suit)
    lenses = [garment.build_lens("L"), garment.build_lens("R")]
    garment.recess_lenses(mask, lenses)
    mask.data.materials.append(mats["MASK"])
    for lens in lenses:
        lens.data.materials.append(mats["LENS"])
    log["mask"] = meshops.describe(mask)

    # --- 13: web-shooter -----------------------------------------------------
    mechanical = []
    for side in ("L", "R"):
        for part in webshooter.build_web_shooter(side):
            role = next(k for k in PART_MATERIAL if k in part.name)
            part.data.materials.append(mats[PART_MATERIAL[role]])
            mechanical.append(part)
    log["mechanical"] = [p.name for p in mechanical]

    objects = [suit, mask] + lenses + mechanical

    # UVs on every shipped mesh — see meshops.unwrap for why this matters even
    # though no material samples them yet.
    for ob in objects:
        meshops.unwrap(ob, context=f"uv {ob.name}")
    log["uv"] = f"{sum(1 for o in objects if o.data.uv_layers)}/{len(objects)} meshes unwrapped"

    return suit, objects, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suit-id", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--subdivisions", type=int, default=3)
    ap.add_argument("--sculpt", type=float, default=2.1)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--resolution", type=int, default=720)
    ap.add_argument("--views", default="")
    ap.add_argument("--skip-render", action="store_true")
    ap.add_argument("--cinematic", action="store_true", default=True)
    args = ap.parse_args()

    started = time.time()
    out_dir = os.path.abspath(args.out_dir)
    for sub in ("", "source", "qa", "renders"):
        os.makedirs(os.path.join(out_dir, sub), exist_ok=True)

    suit, objects, log = build(args)
    for key, value in log.items():
        print(f"BUILD {key}: {value}", flush=True)

    renders = []
    if not args.skip_render:
        views = [v for v in args.views.split(",") if v] or DIAGNOSTIC_VIEWS
        # Diagnostic first, and it is the set that decides whether the asset is
        # acceptable. Cinematic is a presentation frame, never a judgement.
        rendering.diagnostic_rig()
        renders += rendering.render_views(out_dir, views, samples=args.samples, resolution=args.resolution)
        if args.cinematic:
            rendering.cinematic_rig()
            renders += rendering.render_views(
                out_dir, ["cinematic"], samples=int(args.samples * 1.5), resolution=args.resolution
            )

    # --- export --------------------------------------------------------------
    glb = os.path.join(out_dir, "suit.glb")
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in objects)
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        export_apply=True,
        use_selection=True,
        export_cameras=False,
        export_lights=False,
    )

    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("build_suit.py", "anatomy.py", "body.py", "sculpt.py", "garment.py",
                 "webshooter.py", "materials.py", "meshops.py", "rendering.py", "contract.py"):
        with open(os.path.join(here, name)) as fh:
            content = fh.read()
        with open(os.path.join(out_dir, "source", name), "w") as fh:
            fh.write(content)

    stats = measure_scene(bpy, objects)
    build_ms = int((time.time() - started) * 1000)

    manifest, _metadata = write_bundle(
        out_dir,
        args.suit_id,
        provider="blender-local",
        recipe="suit",
        parameters={
            "subdivisions": args.subdivisions,
            "sculpt": args.sculpt,
            "samples": args.samples,
            "resolution": args.resolution,
        },
        provenance={
            "origin": "AUTHORED",
            "description": (
                "Authored in Blender (bpy) from a published-anthropometry skeleton for a "
                "1.75 m figure, surfaced with the Skin modifier, subdivided, and sculpted "
                "with parametric muscle displacement fields. Mask, lenses and web-shooter "
                "modelled as separate solids. No third-party mesh, scan, or generated asset "
                "is incorporated."
            ),
            "license": "Owned by this project.",
        },
        stats=stats,
        build_ms=build_ms,
        facing_axis="+Z",
    )

    print(f"STATS {stats}", flush=True)
    print(f"BUILD_MS {build_ms}", flush=True)
    print(f"RENDERS {len(renders)}", flush=True)
    print(f"FILES {len(manifest['files'])}", flush=True)
    print(f"GLB {glb}", flush=True)


if __name__ == "__main__":
    main()
