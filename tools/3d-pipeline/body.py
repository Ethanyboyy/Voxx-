"""Builds the figure from the anatomy skeleton graph.

Method: a wire skeleton (one edge per bone, an elliptical radius per joint) run
through Blender's SKIN modifier, then subdivided.

This replaces the previous approach of sweeping tubes and boolean-unioning them
onto a torso. That approach produced the two defects the base mesh was rejected
for — limbs reading as separate cylinders beside the body, and junctions that
were either open holes or silently deleted anatomy. SKIN generates connected
geometry AT the branch points by construction, so shoulders, hips and knuckles
come out as continuous volume with no boolean involved at all.
"""

import bmesh
import bpy

import anatomy
import meshops


def _mirrored_joints():
    """Every joint in the figure, with sides resolved to concrete names."""
    joints = dict(anatomy.CENTRE_JOINTS)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        for name, (x, y, z, rx, ry) in anatomy.SIDE_JOINTS.items():
            joints[f"{name}_{side}"] = (sign * x, y, z, rx, ry)
    return joints


def _mirrored_bones():
    bones = list(anatomy.CENTRE_BONES)
    for side in ("L", "R"):
        for a, b in anatomy.SIDE_BONES:
            bones.append((f"{a}_{side}", f"{b}_{side}"))
        for centre, limb in anatomy.ATTACHMENTS:
            bones.append((centre, f"{limb}_{side}"))
    return bones


def build_body(subdivisions=2):
    """Returns the finished body object.

    Every stage is validated: a Skin modifier that fails produces a tangle
    rather than an error, and a subdivision that runs away produces a mesh too
    heavy to ship. Both are caught here rather than in a render.
    """
    joints = _mirrored_joints()
    bones = _mirrored_bones()

    bm = bmesh.new()
    index = {}
    for name, (x, y, z, _rx, _ry) in joints.items():
        v = bm.verts.new((x, y, z))
        index[name] = v
    bm.verts.index_update()
    order = {name: index[name].index for name in joints}

    for a, b in bones:
        if a not in index or b not in index:
            raise meshops.MeshOperationError(f"bone references unknown joint: {a} → {b}")
        try:
            bm.edges.new((index[a], index[b]))
        except ValueError:
            # Duplicate edge — harmless, but worth not silently doubling.
            pass

    me = bpy.data.meshes.new("body")
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new("SuitBody", me)
    bpy.context.scene.collection.objects.link(ob)
    meshops.activate(ob)

    mod = ob.modifiers.new("skin", "SKIN")
    mod.use_smooth_shade = True
    # Skin data only exists once the modifier does.
    layer = ob.data.skin_vertices[0].data
    for name, (_x, _y, _z, rx, ry) in joints.items():
        layer[order[name]].radius = (rx, ry)
    layer[order[anatomy.ROOT_JOINT]].use_root = True

    # A wire skeleton has zero faces, so the polygon-ratio guard cannot apply
    # here; the dimension bounds are what prove the skin actually generated a
    # body rather than a tangle or nothing.
    #
    # SKIN emits a COARSE cage — roughly a dozen faces per bone, a few hundred
    # in total — and the density arrives from the subdivision below. The
    # threshold is set against that cage, not against the finished mesh.
    expected_faces = max(len(bones) * 4, 120)
    meshops.apply_modifier(
        ob, mod,
        context="skin",
        min_ratio=0.0, max_ratio=float("inf"),
        min_verts=expected_faces, min_polys=expected_faces,
        min_dim=0.2, max_dim=2.2,
    )

    meshops.cleanup(ob)
    meshops.subdivide(ob, levels=subdivisions, context="body subsurf")

    # The face carries more shape per square centimetre than anywhere else, and
    # the mask sits only 8 mm off it, so every facial landmark telegraphs
    # through. Refine the head locally rather than raising the global level —
    # that would multiply the whole mesh by four to buy detail on a forearm
    # with nothing to describe.
    meshops.refine_region(ob, lambda c: c.z > 1.50, cuts=1, context="head refine")
    meshops.shade_smooth(ob, angle_degrees=60.0)

    # Height is the one measurement that has caught a corrupted build before:
    # a figure of arms and legs with no torso still has plausible vertex counts.
    height = ob.dimensions.z
    if not (1.6 < height < 1.85):
        raise meshops.MeshOperationError(
            f"body height {height:.3f} m is not a 1.75 m figure — anatomy is missing"
        )
    return ob
