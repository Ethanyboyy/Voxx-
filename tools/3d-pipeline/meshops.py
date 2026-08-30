"""Validated mesh operations.

Blender's modelling operators mostly do not raise on failure. A failed EXACT
boolean returns an EMPTY mesh; a failed Skin modifier returns a tangle; a bad
solidify inverts. All three look like ordinary success to the calling script,
and the only symptom is a render with anatomy missing — which cost two full
build/render cycles to diagnose once already.

So every operation in this module states what it expects and checks afterwards.
An implausible result raises immediately rather than propagating corrupted
geometry downstream.
"""

import bpy


class MeshOperationError(RuntimeError):
    """A modelling operation produced an implausible result."""


def snapshot(ob):
    """The numbers worth comparing across an operation."""
    me = ob.data
    return {
        "verts": len(me.vertices),
        "polys": len(me.polygons),
        "dims": tuple(round(d, 4) for d in ob.dimensions),
    }


def describe(ob):
    s = snapshot(ob)
    return f"{ob.name}: {s['verts']}v {s['polys']}f dims={s['dims']}"


def activate(ob):
    """Makes `ob` the sole active+selected object, as operators require."""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    return ob


def validate(ob, *, min_verts=1, min_polys=1, min_dim=None, max_dim=None, context=""):
    """Raises unless the object still looks like real geometry.

    `min_dim`/`max_dim` are per-axis bounds on the object's world dimensions,
    which is what catches the collapse cases: an emptied mesh reports zero
    extent, and a runaway boolean or solidify reports absurd extent.
    """
    if ob is None or ob.name not in bpy.data.objects:
        raise MeshOperationError(f"{context}: object no longer exists")

    s = snapshot(ob)
    if s["verts"] < min_verts or s["polys"] < min_polys:
        raise MeshOperationError(
            f"{context}: collapsed to {s['verts']}v {s['polys']}f "
            f"(wanted >={min_verts}v >={min_polys}f)"
        )
    if min_dim is not None and min(s["dims"]) < min_dim:
        raise MeshOperationError(f"{context}: dimension below {min_dim} — {s['dims']}")
    if max_dim is not None and max(s["dims"]) > max_dim:
        raise MeshOperationError(f"{context}: dimension above {max_dim} — {s['dims']}")
    return s


def apply_modifier(ob, mod, *, context="", min_ratio=0.25, max_ratio=200.0, **checks):
    """Applies a modifier and verifies the result is plausible.

    `min_ratio` guards against collapse, `max_ratio` against explosion, both
    relative to the polygon count going in. A boolean that deletes the torso
    trips the first; a runaway subdivision trips the second.
    """
    before = snapshot(ob)
    activate(ob)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = validate(ob, context=context or mod.name, **checks)

    if before["polys"]:
        ratio = after["polys"] / before["polys"]
        if ratio < min_ratio or ratio > max_ratio:
            raise MeshOperationError(
                f"{context or mod.name}: polygon count went {before['polys']} → "
                f"{after['polys']} (ratio {ratio:.3f}), outside "
                f"[{min_ratio}, {max_ratio}] — the operation probably failed"
            )
    return after


def safe_boolean(ob, other, operation="UNION", *, context="", **checks):
    """Boolean with the EXACT solver, validated afterwards.

    Kept for hard-surface work. The body deliberately does not use booleans at
    all any more — the Skin modifier builds connected limb junctions directly,
    which removes this entire failure class from the anatomy.
    """
    mod = ob.modifiers.new(f"bool_{other.name}", "BOOLEAN")
    mod.operation = operation
    mod.object = other
    mod.solver = "EXACT"
    return apply_modifier(
        ob, mod,
        context=context or f"{operation} {ob.name} ⨯ {other.name}",
        min_ratio=0.5 if operation == "UNION" else 0.1,
        **checks,
    )


def cleanup(ob, *, merge_distance=1e-5, recalc_normals=True):
    """Merges doubles and fixes winding.

    Degenerate geometry is what breaks downstream operators, and mirrored parts
    come out inside-out — which renders as black patches rather than as
    anything that looks like a modelling error.
    """
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=merge_distance)
    if recalc_normals:
        bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def count_non_manifold(ob):
    """Number of non-manifold vertices — holes, stray edges, bad junctions."""
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_non_manifold()
    bpy.ops.object.mode_set(mode="OBJECT")
    return sum(1 for v in ob.data.vertices if v.select)


def subdivide(ob, levels=2, *, context="subsurf"):
    mod = ob.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    mod.use_limit_surface = True
    return apply_modifier(ob, mod, context=context, max_ratio=6 ** levels)


def shade_smooth(ob, angle_degrees=48.0):
    """Smooth shading with an auto-smooth angle.

    Object.shade_smooth() does not exist on bpy 5.x, and unqualified smooth
    shading rounds off edges that should stay crisp — so hard-surface parts
    keep their definition via a weighted-normal/angle split instead.
    """
    import math
    activate(ob)
    # There is no SMOOTH_BY_ANGLE modifier type on bpy 5.x — auto-smooth is an
    # operator that installs its own node group. Verified against
    # bpy.types.Modifier's enum rather than assumed.
    bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_degrees))
    return ob


def unwrap(ob, *, angle_limit=66.0, island_margin=0.008, context="uv"):
    """Smart UV Project, so the exported GLB carries a real TEXCOORD_0.

    Nothing in this pipeline samples a UV map yet — the materials are all
    procedural. It matters anyway for two reasons: the runtime loader's material
    path expects UVs on a suit asset, and every remaining quality step that this
    pipeline CANNOT currently do (clean panel boundaries, the web pattern,
    fabric microstructure that survives close inspection, insignia) is blocked
    on having them. Unwrapping now means those are a baking stage away rather
    than a re-authoring job.
    """
    import math
    activate(ob)
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_limit), island_margin=island_margin)
    bpy.ops.object.mode_set(mode="OBJECT")

    if not ob.data.uv_layers:
        raise MeshOperationError(f"{context}: unwrap produced no UV layer on {ob.name}")
    return ob


def weighted_normals(ob):
    """Weighted normals — keeps bevelled hard-surface faces reading flat.

    Only meaningful on the mechanical parts; applying it to the garment gains
    nothing and costs a modifier evaluation.
    """
    activate(ob)
    mod = ob.modifiers.new("weighted_normal", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    return apply_modifier(ob, mod, context=f"weighted normals {ob.name}", min_ratio=0.9, max_ratio=1.1)
