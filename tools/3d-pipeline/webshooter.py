"""The web-shooter: a real mechanical assembly, five addressable parts.

Each part is its own object with its own name, because the Suit Bay's
drill-down bottoms out here — suit → arm → web-shooter → cartridge — and a
single fused blob would collapse the two deepest levels of that interaction.

Names match the ids the runtime already uses (see
src/components/lab/three/WristSystem.tsx and src/lib/lab/drilldown.ts):
wristHousing / wristMechanism / wristCartridge / wristNozzle / wristTrigger,
suffixed L or R.

Mounting is against the forearm's real surface rather than at a hand-picked
coordinate: the housing is curved to the arm's radius and seated on it, so it
neither floats nor sinks into the wrist.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import meshops

#: Where on the arm the device sits, and how the arm runs there.
#: Taken from the anatomy skeleton: wrist (0.256, 0.016, 0.876) and
#: forearm (0.242, 0.012, 1.010), so the axis is the real forearm direction.
WRIST = Vector((0.256, 0.016, 0.876))
FOREARM = Vector((0.242, 0.012, 1.010))
ARM_RADIUS = 0.030


def _arm_frame(side):
    """Orthonormal frame at the mount: +Z along the arm, +Y away from the body."""
    sign = 1.0 if side == "L" else -1.0
    wrist = Vector((sign * WRIST.x, WRIST.y, WRIST.z))
    forearm = Vector((sign * FOREARM.x, FOREARM.y, FOREARM.z))

    up = (forearm - wrist).normalized()          # along the arm, toward the elbow
    out = Vector((sign * 1.0, 0.0, 0.0))          # outboard, away from the torso
    out = (out - up * out.dot(up)).normalized()

    # Local axes are X = forward, Y = OUTBOARD, Z = along the arm.
    #
    # Y must be the outboard direction because every part offset below and the
    # curved shell's arc are both written around +Y. A first version put `out`
    # on local X, so the mechanism and cartridge were offset along the forearm's
    # forward direction instead — they stood off the arm like a fin.
    #
    # fwd = out × up (not up × out) keeps the basis right-handed; the other
    # order gives determinant -1 and mirrors every part it places.
    fwd = out.cross(up).normalized()
    return wrist, Matrix((fwd, out, up)).transposed()


def _curved_shell(bm, *, radius, thickness, arc, length, taper=1.0):
    """An annular-sector shell — a plate curved to sit flush on a cylinder.

    A flat slab on a round forearm either floats at its edges or buries its
    centre. Curving the housing to the arm's own radius is the difference
    between a device that is mounted and one that is hovering.
    """
    outer = radius + thickness
    half = arc * 0.5
    steps = 20
    rings = []
    for end in (-0.5, 0.5):
        z = end * length
        scale = 1.0 + (taper - 1.0) * (end + 0.5)
        ring = []
        for i in range(steps + 1):
            a = -half + (i / steps) * arc
            ring.append((math.sin(a), math.cos(a), z, scale))
        rings.append(ring)

    verts = []
    for ring in rings:
        inner_row, outer_row = [], []
        for sa, ca, z, sc in ring:
            inner_row.append(bm.verts.new((sa * radius * sc, ca * radius * sc, z)))
            outer_row.append(bm.verts.new((sa * outer * sc, ca * outer * sc, z)))
        verts.append((inner_row, outer_row))

    (i0, o0), (i1, o1) = verts
    for i in range(steps):
        bm.faces.new((o0[i], o0[i + 1], o1[i + 1], o1[i]))   # outer surface
        bm.faces.new((i0[i + 1], i0[i], i1[i], i1[i + 1]))   # inner surface
    for i in range(steps):
        bm.faces.new((i0[i], i0[i + 1], o0[i + 1], o0[i]))   # end cap
        bm.faces.new((o1[i], o1[i + 1], i1[i + 1], i1[i]))   # end cap
    for row_in, row_out in ((i0, o0),):
        pass
    # side walls along the arc edges
    bm.faces.new((i0[0], i1[0], o1[0], o0[0]))
    bm.faces.new((o0[steps], o1[steps], i1[steps], i0[steps]))
    bm.normal_update()
    return bm


def _merge(target, source):
    """Appends `source` geometry into `target` and frees it."""
    verts = [target.verts.new(v.co) for v in source.verts]
    target.verts.index_update()
    for face in source.faces:
        try:
            target.faces.new([verts[v.index] for v in face.verts])
        except ValueError:
            pass
    source.free()
    target.normal_update()
    return target


def _mesh_from(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _place(ob, origin, basis, local_offset):
    """Puts a locally-built part onto the arm."""
    ob.matrix_world = Matrix.Translation(origin + basis @ Vector(local_offset)) @ basis.to_4x4()
    meshops.activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def _box(bm, sx, sy, sz, bevel=0.0012):
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    return bm


def _bolt(bm, radius=0.0016, depth=0.0022, segments=10):
    """A small pan-head fastener. Detail at this scale is what separates a
    modelled mechanism from a primitive: the eye reads fasteners as evidence
    that something was assembled rather than extruded."""
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius * 0.82, depth=depth,
    )
    return bm


def build_web_shooter(side):
    """Returns the five parts, in mount order.

    Each part is a separate object because the drill-down bottoms out here, but
    the DETAIL parts (strap, bolts, aperture ring) are merged into whichever
    addressable part they belong to — a fastener is not something the user
    should be able to select and price.
    """
    origin, basis = _arm_frame(side)
    parts = []

    # --- housing: curved to the forearm, straddling the ulnar face -----------
    # Built as a stack: the main shell, a narrower retention strap wrapping
    # further round the arm, and four fasteners at the shell corners. A single
    # smooth slab reads as a prop; the strap explains HOW it stays on, which is
    # the question a viewer asks about a wearable device.
    bm = bmesh.new()
    _curved_shell(bm, radius=ARM_RADIUS - 0.002, thickness=0.0058, arc=math.radians(142), length=0.048)

    strap = bmesh.new()
    _curved_shell(strap, radius=ARM_RADIUS - 0.004, thickness=0.0030, arc=math.radians(292), length=0.0115)
    for v in strap.verts:
        v.co.z -= 0.0175
    _merge(bm, strap)

    strap2 = bmesh.new()
    _curved_shell(strap2, radius=ARM_RADIUS - 0.004, thickness=0.0030, arc=math.radians(292), length=0.0115)
    for v in strap2.verts:
        v.co.z += 0.0175
    _merge(bm, strap2)

    for sx, sz in ((-0.0125, -0.0155), (0.0125, -0.0155), (-0.0125, 0.0155), (0.0125, 0.0155)):
        head = bmesh.new()
        _bolt(head)
        for v in head.verts:
            # Lay the bolt along +Y (outboard) and seat it on the shell face.
            v.co = Vector((v.co.x + sx, v.co.z + ARM_RADIUS + 0.0048, v.co.y + sz))
        _merge(bm, head)

    housing = _mesh_from(bm, f"wristHousing{side}")
    _place(housing, origin, basis, (0.0, 0.0, 0.034))
    meshops.cleanup(housing)
    meshops.shade_smooth(housing, 34)
    parts.append(housing)

    # --- firing mechanism: proud of the housing on the outboard face ---------
    bm = bmesh.new()
    _box(bm, 0.0165, 0.0100, 0.0260, bevel=0.0015)
    mech = _mesh_from(bm, f"wristMechanism{side}")
    _place(mech, origin, basis, (0.0, ARM_RADIUS + 0.0088, 0.034))
    meshops.shade_smooth(mech, 34)
    parts.append(mech)

    # --- cartridge: a cylinder seated ACROSS the housing ---------------------
    # Laid transverse and half-sunk into the mechanism block so it visibly
    # interfaces with it rather than resting nearby.
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=24,
        radius1=0.0060, radius2=0.0060, depth=0.0225,
    )
    for v in bm.verts:  # lay the cylinder transverse, across the arm
        v.co = Vector((v.co.z, v.co.y, v.co.x))
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=0.0008, segments=2, affect="EDGES")
    cartridge = _mesh_from(bm, f"wristCartridge{side}")
    _place(cartridge, origin, basis, (0.0, ARM_RADIUS + 0.0120, 0.0225))
    meshops.shade_smooth(cartridge, 34)
    parts.append(cartridge)

    # --- emitter nozzle: points down the hand, with a real output path -------
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=20,
        radius1=0.0062, radius2=0.0040, depth=0.0150,
    )
    for v in bm.verts:  # aim along -Z, toward the hand
        v.co = Vector((v.co.x, v.co.y, -v.co.z))
    ring = bmesh.new()
    bmesh.ops.create_cone(
        ring, cap_ends=False, cap_tris=False, segments=20,
        radius1=0.0075, radius2=0.0075, depth=0.0026,
    )
    for v in ring.verts:
        v.co = Vector((v.co.x, v.co.y, -v.co.z * 1.0 - 0.0062))
    _merge(bm, ring)
    nozzle = _mesh_from(bm, f"wristNozzle{side}")
    _place(nozzle, origin, basis, (0.0, ARM_RADIUS + 0.0035, 0.0010))
    meshops.shade_smooth(nozzle, 34)
    parts.append(nozzle)

    # --- trigger pad: palm side, where a middle finger actually reaches ------
    bm = bmesh.new()
    _box(bm, 0.0110, 0.0042, 0.0135, bevel=0.0010)
    trigger = _mesh_from(bm, f"wristTrigger{side}")
    _place(trigger, origin, basis, (0.0, -(ARM_RADIUS + 0.0018), 0.0180))
    meshops.shade_smooth(trigger, 34)
    parts.append(trigger)

    for part in parts:
        meshops.validate(part, min_verts=8, min_polys=6, context=f"web-shooter {part.name}")
    return parts
