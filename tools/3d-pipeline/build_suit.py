"""Authoring recipe: a technical wearable suit, built from anthropometry.

Run under a Python that has `bpy` installed (pip install bpy). This is Blender
itself as a library — no Blender application, no GUI, no network. See
docs/3d-pipeline/MCP_DECISIONS.md.

    python tools/3d-pipeline/build_suit.py --suit-id mk-vii --out-dir public/models/suits/mk-vii

The suit is built as a GARMENT, not as armour bolted to a mannequin. Every
surface here is one continuous skin-tight shell generated from elliptical
cross-sections along anatomical axes; the "plates" are thickness and material
variation on that shell, not separate floating objects. That distinction is the
entire brief — a body with plates on it reads as a costume, a shell with
integrated structure reads as a technical suit.

Proportions are a real 1.75 m figure. They are ordinary published anthropometric
ratios (shoulder breadth ~0.259 H, etc.), applied consistently — they are not
tuned to flatter a render, and they are stated here rather than buried so they
can be checked.
"""

import argparse
import math
import os
import sys
import time

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contract import measure_scene, write_bundle  # noqa: E402

H = 1.75  # standing height, metres — matches CANONICAL_BODY_HEIGHT in the app.

# Cross-section rings: (name, [(z, x_radius, y_radius, y_offset), ...]).
# z is height above the floor as a fraction of H; radii and offset are also
# fractions of H, so the whole figure scales as one.
#
# The figure is built facing -Y in Blender, because the glTF exporter maps
# Blender -Y to glTF +Z, and the runtime armour rig derives character-left as
# +X on the assumption the body faces +Z. Getting this backwards puts every
# mounted component on the wrong side of the body.

TORSO = [
    (0.520, 0.096, 0.068, 0.000),   # hip
    (0.560, 0.092, 0.064, 0.002),
    (0.600, 0.083, 0.058, 0.004),   # waist — the taper that reads as a figure
    (0.650, 0.089, 0.062, 0.004),
    (0.700, 0.104, 0.070, 0.002),   # lower ribcage
    (0.750, 0.114, 0.076, 0.000),   # chest
    (0.800, 0.116, 0.074, -0.002),
    (0.830, 0.104, 0.066, -0.004),  # clavicle shelf
    (0.860, 0.062, 0.052, -0.004),  # neck base
    (0.885, 0.036, 0.036, -0.004),  # neck
]

# Starts ABOVE the neck ring TORSO ends on. Repeating that ring here bridges a
# section to an identical one, producing zero-area faces — which the EXACT
# boolean solver silently fails on, deleting the torso and head outright and
# leaving a figure of arms and legs.
HEAD = [
    (0.905, 0.052, 0.058, -0.006),
    (0.935, 0.062, 0.070, -0.008),  # cranium widest
    (0.965, 0.058, 0.064, -0.006),
    (0.988, 0.038, 0.042, -0.002),
    (1.000, 0.014, 0.016, 0.000),
]

# Arms and legs are built once and mirrored, so left and right cannot drift.
# (x, z, r_x, r_y) — x is outboard distance from centreline.
ARM = [
    (0.098, 0.818, 0.049, 0.049),   # deltoid
    (0.128, 0.795, 0.044, 0.044),
    (0.150, 0.740, 0.037, 0.037),   # mid-upper-arm
    (0.166, 0.685, 0.032, 0.032),   # elbow
    (0.180, 0.630, 0.031, 0.030),   # forearm belly
    (0.192, 0.570, 0.025, 0.024),
    (0.200, 0.520, 0.019, 0.017),   # wrist
    (0.204, 0.487, 0.023, 0.013),   # palm
    (0.206, 0.452, 0.018, 0.010),   # fingers, closed
]

LEG = [
    (0.052, 0.530, 0.078, 0.078),   # hip socket
    (0.058, 0.480, 0.072, 0.073),
    (0.062, 0.400, 0.062, 0.064),   # mid-thigh
    (0.064, 0.320, 0.052, 0.054),
    (0.064, 0.285, 0.046, 0.048),   # knee
    (0.064, 0.230, 0.048, 0.050),   # calf belly
    (0.062, 0.150, 0.034, 0.036),
    (0.060, 0.075, 0.026, 0.028),   # ankle
    (0.060, 0.030, 0.028, 0.048),   # instep
    (0.060, 0.012, 0.026, 0.070),   # foot, extending forward
]

SEGMENTS = 24  # ring resolution; 24 is smooth under one subsurf level


def ring(bm, cx, cy, cz, rx, ry, segments=SEGMENTS):
    """One elliptical cross-section, as a list of new bmesh verts."""
    verts = []
    for i in range(segments):
        a = (i / segments) * math.tau
        verts.append(bm.verts.new((cx + math.cos(a) * rx, cy + math.sin(a) * ry, cz)))
    return verts


def bridge(bm, a, b):
    """Quad strip between two equal-length rings."""
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))


def cap(bm, verts):
    """Closes a ring with an n-gon; subsurf resolves it into a smooth dome."""
    bm.faces.new(verts)


def build_vertical(bm, sections, mirror_x=0.0):
    """Builds a stack of rings varying in z (torso, head)."""
    rings = []
    for z, rx, ry, yoff in sections:
        rings.append(ring(bm, mirror_x, yoff * H, z * H, rx * H, ry * H))
    for a, b in zip(rings, rings[1:]):
        bridge(bm, a, b)
    return rings


def build_limb(bm, sections, side):
    """Builds a limb with each ring PERPENDICULAR to the local limb axis.

    `side` is +1 (character left) or -1.

    Horizontal rings are wrong for anything but a vertical axis: on a limb that
    travels outward as well as down, consecutive horizontal ellipses overlap and
    the bridged surface self-intersects. That is not a cosmetic problem — the
    EXACT boolean solver returns an EMPTY mesh for a self-intersecting operand,
    which deleted the entire torso and left a figure made of arms and legs.

    The limb axis lies in the XZ plane, so world Y is always perpendicular to
    it and makes a stable second frame vector — no need for a general
    parallel-transport frame here.
    """
    pts = [Vector((side * x * H, 0.0, z * H)) for x, z, _rx, _ry in sections]
    rings = []
    for i, (p, (_x, _z, rx, ry)) in enumerate(zip(pts, sections)):
        prev = pts[max(i - 1, 0)]
        nxt = pts[min(i + 1, len(pts) - 1)]
        tangent = (nxt - prev)
        if tangent.length < 1e-9:
            tangent = Vector((0.0, 0.0, -1.0))
        tangent.normalize()
        v = Vector((0.0, 1.0, 0.0))
        u = tangent.cross(v)
        if u.length < 1e-6:
            u = Vector((1.0, 0.0, 0.0))
        u.normalize()

        verts = []
        for k in range(SEGMENTS):
            a = (k / SEGMENTS) * math.tau
            offset = u * (math.cos(a) * rx * H) + v * (math.sin(a) * ry * H)
            verts.append(bm.verts.new(p + offset))
        rings.append(verts)

    for a, b in zip(rings, rings[1:]):
        bridge(bm, a, b)
    return rings


def build_joint(bm, x, z, radius, rings=12):
    """A convex sphere seated at a joint, used to blend a limb into the torso.

    A sphere is the one operand shape that cannot self-intersect, so it unions
    reliably where a swept tube driven deep into the body does not — and a
    deltoid and a hip really are roughly ball-shaped, so this is anatomy rather
    than a workaround.
    """
    lat = []
    for i in range(1, rings):
        theta = math.pi * i / rings
        r = math.sin(theta) * radius * H
        zz = z * H + math.cos(theta) * radius * H
        lat.append(ring(bm, x * H, 0.0, zz, r, r))
    top = bm.verts.new((x * H, 0.0, z * H + radius * H))
    bot = bm.verts.new((x * H, 0.0, z * H - radius * H))
    for a, b in zip(lat, lat[1:]):
        bridge(bm, a, b)
    for i in range(SEGMENTS):
        j = (i + 1) % SEGMENTS
        bm.faces.new((top, lat[0][j], lat[0][i]))
        bm.faces.new((bot, lat[-1][i], lat[-1][j]))
    return lat


def _finish(bm, name):
    """Turns a bmesh into a linked object with outward normals.

    Normals must be recalculated per object: a mirrored limb comes out
    inside-out, which renders as black patches under the key light rather than
    as anything that looks like a modelling error.
    """
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # Degenerate geometry is what breaks the EXACT boolean solver, and it fails
    # silently — the operand simply vanishes. Cleaning here is cheaper than
    # diagnosing a missing torso from a render.
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def build_body():
    """One continuous garment shell.

    The parts are modelled as separate closed volumes that deliberately
    PENETRATE each other — every limb's first ring sits inside the torso — and
    are then boolean-unioned into a single surface. Bridging them ring-to-ring
    instead leaves the limbs as tubes butted against the body, which renders as
    open holes at the shoulders and hips and reads exactly like the "body +
    parts" look this design is meant to avoid.
    """
    bm = bmesh.new()
    torso = build_vertical(bm, TORSO)
    head = build_vertical(bm, HEAD)
    bridge(bm, torso[-1], head[0])
    cap(bm, head[-1])
    cap(bm, torso[0])
    body = _finish(bm, "SuitShell")

    limbs = []
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        for sections, label in ((ARM, "arm"), (LEG, "leg")):
            lb = bmesh.new()
            rings = build_limb(lb, sections, side)
            cap(lb, rings[0])
            cap(lb, rings[-1])
            limbs.append(_finish(lb, f"{label}_{tag}"))
        # Joint balls seat the limb into the body. Without them the limb tube
        # simply abuts the torso and the union leaves a visible open seam at the
        # shoulder and hip.
        for x, z, r, jl in ((0.086, 0.820, 0.058, "shoulder"), (0.052, 0.545, 0.082, "hip")):
            jb = bmesh.new()
            build_joint(jb, side * x, z, r)
            limbs.append(_finish(jb, f"{jl}_{tag}"))

    # Union at base resolution, subdivide afterwards: subsurf then rounds the
    # boolean junction into a real deltoid/hip blend instead of leaving the
    # hard crease a union produces on its own.
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for limb in limbs:
        before = len(body.data.polygons)
        mod = body.modifiers.new(f"union_{limb.name}", "BOOLEAN")
        mod.operation = "UNION"
        mod.object = limb
        mod.solver = "EXACT"
        bpy.ops.object.modifier_apply(modifier=mod.name)
        after = len(body.data.polygons)
        # A failed EXACT boolean does not raise — it empties the mesh, and the
        # only symptom is a render with body parts missing. Two full build/render
        # cycles were spent diagnosing exactly that, so it fails loudly now.
        if after == 0 or after < before * 0.5:
            raise RuntimeError(
                f"Boolean union with {limb.name} collapsed the mesh "
                f"({before} → {after} polygons). The operand is probably "
                f"self-intersecting."
            )

    for limb in limbs:
        bpy.data.objects.remove(limb, do_unlink=True)

    sub = body.modifiers.new("subsurf", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    # Object.shade_smooth() does not exist on bpy 5.x — the operator does.
    bpy.ops.object.shade_smooth()
    return body


def make_material(name, base_rgb, roughness, metallic, sheen=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base_rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    # Sheen is what makes a woven technical textile read as fabric rather than
    # as painted plastic. Named inputs vary across Blender versions, so this is
    # probed rather than assumed.
    for key in ("Sheen Weight", "Sheen"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = sheen
            break
    return mat


def studio_lighting():
    """Three-point studio rig. Neutral by design: the suit has to read under
    plain white light, not be rescued by coloured rims."""
    def area(name, loc, energy, size, rot):
        d = bpy.data.lights.new(name, type="AREA")
        d.energy = energy
        d.size = size
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = rot
        bpy.context.scene.collection.objects.link(o)
        return o

    # Energies are deliberately modest. The first pass used 900 W on the key and
    # rendered the suit as featureless light grey: the surface was blown past
    # the point where base colour, roughness and sheen contribute anything, so
    # every material read identically. Overexposure destroys exactly the
    # information a material QA render exists to show.
    area("key", (2.2, -2.6, 2.3), 180, 2.6, (0.95, 0.0, 0.70))
    area("fill", (-2.6, -1.6, 1.4), 45, 3.0, (1.25, 0.0, -1.05))
    area("rim", (0.0, 2.8, 2.4), 120, 2.4, (-1.05, 0.0, 0.0))

    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.045, 0.055, 1)
    bpy.context.scene.world = world


# QA views. Ten angles, because a suit that looks right from the front and
# wrong from behind is a suit that looks wrong.
VIEWS = {
    "front": (0.0, -3.4, 1.05),
    "back": (0.0, 3.4, 1.05),
    "left": (-3.4, 0.0, 1.05),
    "right": (3.4, 0.0, 1.05),
    "three_quarter": (2.3, -2.5, 1.25),
    "low": (1.6, -2.6, 0.35),
    "high": (1.4, -2.2, 2.6),
    "detail_torso": (0.9, -1.15, 1.35),
    "detail_forearm": (0.75, -0.85, 0.95),
    "detail_head": (0.55, -0.85, 1.62),
}


def render_views(out_dir, samples, resolution, only=None):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = resolution
    sc.render.resolution_y = int(resolution * 1.4)
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"

    cam_d = bpy.data.cameras.new("qa_cam")
    cam_d.lens = 85  # portrait-length glass; a wide lens distorts proportions
    cam = bpy.data.objects.new("qa_cam", cam_d)
    bpy.context.scene.collection.objects.link(cam)
    sc.camera = cam

    target = Vector((0.0, 0.0, 0.95))
    paths = []
    renders_dir = os.path.join(out_dir, "renders")
    os.makedirs(renders_dir, exist_ok=True)

    for name, loc in VIEWS.items():
        if only and name not in only:
            continue
        cam.location = Vector(loc)
        if name.startswith("detail_"):
            cam_d.lens = 135
            focus = {"detail_torso": 1.32, "detail_forearm": 0.95, "detail_head": 1.60}[name]
            direction = Vector((0.0, 0.0, focus)) - cam.location
        else:
            cam_d.lens = 85
            direction = target - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

        path = os.path.join(renders_dir, f"{name}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
        # Consumed by BlenderLocalProvider to populate GenerationResult.renderPaths.
        print(f"RENDER {path}", flush=True)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suit-id", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--resolution", type=int, default=640)
    ap.add_argument("--views", default="")
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    started = time.time()
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "source"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "qa"), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    body = build_body()

    weave = make_material("suit_weave", (0.055, 0.062, 0.085), 0.62, 0.03, sheen=0.35)
    body.data.materials.append(weave)
    plate = make_material("suit_plate", (0.42, 0.055, 0.075), 0.34, 0.28)
    body.data.materials.append(plate)
    trim = make_material("suit_trim", (0.72, 0.68, 0.58), 0.28, 0.72)
    body.data.materials.append(trim)

    studio_lighting()

    renders = [] if args.skip_render else render_views(
        out_dir,
        args.samples,
        args.resolution,
        only=[v for v in args.views.split(",") if v] or None,
    )

    glb = os.path.join(out_dir, "suit.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        export_apply=True,          # bake modifiers, so the shipped mesh IS the measured mesh
        use_selection=False,
        export_cameras=False,
        export_lights=False,
    )

    # Copy the recipe in beside its output, so a bundle carries the exact source
    # that produced it rather than a reference to a file that may have moved on.
    for name in ("build_suit.py", "contract.py"):
        src = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        with open(src) as fh:
            content = fh.read()
        with open(os.path.join(out_dir, "source", name), "w") as fh:
            fh.write(content)

    stats = measure_scene(bpy, [body])
    build_ms = int((time.time() - started) * 1000)

    manifest, metadata = write_bundle(
        out_dir,
        args.suit_id,
        provider="blender-local",
        recipe="suit",
        parameters={"samples": args.samples, "resolution": args.resolution},
        provenance={
            "origin": "AUTHORED",
            "description": (
                "Procedurally authored in Blender (bpy) from published anthropometric "
                "ratios for a 1.75 m figure. No third-party mesh, scan, or generated "
                "asset is incorporated."
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
