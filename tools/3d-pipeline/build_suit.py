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
import texturing       # noqa: E402
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


def srgb_hex_to_linear(value):
    """'#7c5cff' -> linear-space RGB triple.

    Texture base colour is authored in LINEAR space and encoded to sRGB on
    write, so a hex code from the suit record has to be decoded on the way in.
    Passing the sRGB values straight through washes every colour out by roughly
    a factor of two — the mistake that made an earlier build's charcoal read as
    mid-grey.
    """
    text = value.lstrip("#")
    if len(text) != 6:
        raise ValueError(f"expected a 6-digit hex colour, got {value!r}")
    out = []
    for i in (0, 2, 4):
        c = int(text[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


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

    # --- 14: materials -------------------------------------------------------
    # The body's per-face zone slots are gone: apply_baked_material replaces
    # them with one textured material whose panels are drawn per TEXEL.
    # garment.assign_zones() is no longer called from this recipe — it cannot
    # produce a boundary finer than a polygon — but it is kept as the reference
    # implementation of the zone curves that texturing.zone_weights() evaluates.
    mats = materials.build_materials()
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

    for ob in objects:
        meshops.unwrap(ob, context=f"uv {ob.name}")
    log["uv"] = f"{sum(1 for o in objects if o.data.uv_layers)}/{len(objects)} meshes unwrapped"

    # --- 5, 6, 7, 11: baked garment textures --------------------------------
    # The body gets the hero resolution because it is what the camera spends
    # its time on; the mask is smaller in screen area and half the size holds
    # up. Blanket 4K everywhere would triple runtime cost to sharpen a boot.
    images = []
    body_maps = texturing.build_texture_set(
        suit, args.texture_size,
        primary=srgb_hex_to_linear(args.primary),
        panel_colour=srgb_hex_to_linear(args.panel),
        accent_colour=srgb_hex_to_linear(args.accent),
    )
    _mat, imgs = texturing.apply_baked_material(suit, body_maps, "vox_garment", texture_dir=args.texture_dir)
    images += imgs
    log["body_texture"] = f"{args.texture_size}px, {body_maps['coverage'] * 100:.1f}% UV coverage"

    mask_maps = texturing.build_texture_set(
        mask, max(args.texture_size // 2, 512),
        primary=srgb_hex_to_linear(args.mask),
        panel_colour=srgb_hex_to_linear(args.mask),
        accent_colour=srgb_hex_to_linear(args.mask),
        web_scale=130.0,
        weave_scale=2600.0,
    )
    _mmat, mimgs = texturing.apply_baked_material(mask, mask_maps, "vox_mask", texture_dir=args.texture_dir)
    images += mimgs
    log["mask_texture"] = f"{max(args.texture_size // 2, 512)}px, {mask_maps['coverage'] * 100:.1f}% UV coverage"
    log["images"] = [i.name for i in images]

    return suit, objects, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suit-id", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--subdivisions", type=int, default=3)
    ap.add_argument("--sculpt", type=float, default=2.1)
    ap.add_argument("--texture-size", type=int, default=2048)
    # The VOX garment palette.
    #
    # Deliberately TONAL, not chromatic. The previous default was a red panel
    # over a blue body, which — with a web pattern and a full-head mask — is a
    # recognisable copyrighted costume, and reads as one no matter how well it
    # is lit. Construction here comes from a graphite base against a slightly
    # lighter graphite panel: the seams and zones are still completely legible,
    # but as engineered apparel rather than as a superhero suit. Per-suit
    # colour belongs in these arguments, not in the pipeline.
    ap.add_argument("--primary", default="#3a4052", help="Garment base colour (hex).")
    ap.add_argument("--panel", default="#59637d", help="Structural panel colour (hex).")
    ap.add_argument("--accent", default="#22262f", help="Gloves/boots/belt colour (hex).")
    ap.add_argument("--mask", default="#333a4a", help="Mask shell colour (hex).")
    ap.add_argument("--texture-dir", default=None)
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

    args.texture_dir = os.path.join(out_dir, 'textures')
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
                 "webshooter.py", "materials.py", "meshops.py", "rendering.py", "contract.py",
                 "texturing.py"):
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
            "textureSize": args.texture_size,
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
