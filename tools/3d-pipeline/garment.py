"""Garment construction: zones, seams, mask, lenses, and the web-shooter.

The body underneath is a fitted textile garment, not armour. So the "panels"
here are material zones and shallow seam relief on ONE continuous surface —
not separate plates laid over a mannequin. The only genuinely separate solids
are the things that really are separate objects: the mask, the lenses, and the
web-shooter's mechanical parts.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import meshops

# Material slot order. The body carries slots 0-2; the mask, lenses and
# mechanical parts are separate objects with their own slots.
SLOT_TEXTILE = 0   # primary weave — limbs, back, underlayer
SLOT_PANEL = 1     # secondary panel textile — chest, shoulders, shins
SLOT_ACCENT = 2    # accent textile — gloves, boots, belt line

ZONE_SLOTS = ("TEXTILE", "PANEL", "ACCENT")


def _zone_for(co):
    """Which garment zone a point belongs to.

    Zones follow anatomy — a chest panel that stops at the pectoral line, a
    glove that ends at the wrist — because that is what separates a tailored
    garment from arbitrary patches. Evaluated per face centroid.
    """
    x, y, z = co.x, co.y, co.z
    ax = abs(x)

    # Every boundary below is a CURVE, not an axis-aligned plane. Plane cuts
    # produce the stair-stepped rectangles the first pass rendered — a chest
    # panel like a bib and boot tops like sawn-off pipe. Real garment panels
    # follow the body: a yoke dips at the sternum and lifts over the deltoid, a
    # boot cuff rides higher at the back than over the instep.

    # Gloves — cuff angled across the wrist rather than level.
    if ax > 0.185 and z < 0.892 + (y * 0.35):
        return SLOT_ACCENT

    # Boots — cuff higher at the heel, lower over the instep.
    if z < 0.252 + (y * 0.42):
        return SLOT_ACCENT

    # Belt — a shallow arc, deeper at the front.
    if abs(z - (1.012 - y * 0.10)) < 0.024 and ax < 0.142:
        return SLOT_PANEL

    # Chest yoke — the panel's lower edge is a parabola in x, so it sits low at
    # the sternum and sweeps up under the arm along the pectoral line. It runs
    # down to the belt: stopping it at the ribs left a grey band of primary
    # textile across the abdomen that read as an unfinished gap rather than a
    # designed break.
    if y < 0.010 and ax < 0.180:
        lower = 1.036 + 0.150 * (ax / 0.180) ** 2
        if lower < z < 1.412:
            return SLOT_PANEL

    # Shoulder caps — continuous with the yoke, wrapping over the deltoid.
    if z > 1.322 - (ax - 0.120) * 0.60 and 0.118 < ax < 0.232:
        return SLOT_PANEL

    # Knee and shin guard — a rounded shield, not a band: the top edge arcs over
    # the kneecap and the bottom meets the boot cuff.
    if y < 0.045 and 0.255 < z < 0.520:
        knee = ((z - 0.470) / 0.070) ** 2 + ((ax - 0.104) / 0.070) ** 2
        if z < 0.470 or knee < 1.0:
            return SLOT_PANEL

    # Forearm panel — DORSAL face only. Wrapping the whole forearm made the
    # sleeve read as one accent block against a grey glove.
    if 0.905 < z < 1.058 and ax > 0.205 and y < 0.006:
        return SLOT_PANEL

    return SLOT_TEXTILE


def _smooth_zone_boundaries(me, iterations=3):
    """Majority filter over face adjacency, to clean up zone edges.

    Evaluating a smooth boundary curve per face still quantises it to the mesh:
    faces near the edge flip based on where their centroid happens to land, so
    the boundary comes out ragged and speckled with isolated wrong-zone faces.
    Replacing each face's zone with the majority among its edge-neighbours pulls
    those strays back and straightens the run, which is what turns colour-
    blocking into something that reads as a cut panel.

    Faces whose neighbours agree unanimously are left alone, so a zone's
    interior can never be eroded away by repeated passes.
    """
    # Face adjacency via shared edges.
    edge_faces = {}
    for poly in me.polygons:
        for key in poly.edge_keys:
            edge_faces.setdefault(key, []).append(poly.index)

    neighbours = [[] for _ in range(len(me.polygons))]
    for faces in edge_faces.values():
        for a in faces:
            for b in faces:
                if a != b:
                    neighbours[a].append(b)

    for _ in range(iterations):
        current = [p.material_index for p in me.polygons]
        updated = list(current)
        for i, adjacent in enumerate(neighbours):
            if not adjacent:
                continue
            tally = {}
            for j in adjacent:
                tally[current[j]] = tally.get(current[j], 0) + 1
            best, votes = max(tally.items(), key=lambda kv: kv[1])
            # Only flip on a strict majority of neighbours; a tie leaves the
            # face as it is, so genuine boundaries stay where the curve put them.
            if best != current[i] and votes > len(adjacent) / 2:
                updated[i] = best
        for i, slot in enumerate(updated):
            me.polygons[i].material_index = slot


def assign_zones(ob):
    """Writes a material_index per face from the zone rule.

    The previous asset appended three materials and left every face on slot 0,
    so the zoning existed only in the material list. Assignment happens here,
    per polygon, and the counts are returned so a silent regression to
    all-slot-0 is visible in the build log.
    """
    me = ob.data
    for poly in me.polygons:
        poly.material_index = _zone_for(poly.center)

    _smooth_zone_boundaries(me, iterations=3)

    counts = [0, 0, 0]
    for poly in me.polygons:
        counts[poly.material_index] += 1
    me.update()

    if min(counts) == 0:
        raise meshops.MeshOperationError(
            f"zone assignment left an empty material slot: {dict(zip(ZONE_SLOTS, counts))}"
        )
    return dict(zip(ZONE_SLOTS, counts))


# --- seams -------------------------------------------------------------------

#: Seam lines, as (axis, position, halfwidth, depth) planes through the body.
#: A seam is a shallow crease in the surface, not a raised pipe: real garment
#: seams read as a subtle valley catching a line of shadow.
SEAMS = [
    # (predicate name, function returning distance-to-seam in metres)
    ("shoulder_yoke", lambda p: abs(p.z - 1.352) if abs(p.x) < 0.20 else 1.0),
    ("side_seam_l", lambda p: abs(p.x - 0.118) if 1.00 < p.z < 1.34 else 1.0),
    ("side_seam_r", lambda p: abs(p.x + 0.118) if 1.00 < p.z < 1.34 else 1.0),
    ("waist_seam", lambda p: abs(p.z - 1.012) if abs(p.x) < 0.13 else 1.0),
    ("sleeve_head_l", lambda p: abs(p.x - 0.168) if p.z > 1.28 else 1.0),
    ("sleeve_head_r", lambda p: abs(p.x + 0.168) if p.z > 1.28 else 1.0),
    ("glove_cuff_l", lambda p: abs(p.z - 0.888) if p.x > 0.19 else 1.0),
    ("glove_cuff_r", lambda p: abs(p.z - 0.888) if p.x < -0.19 else 1.0),
    ("boot_cuff", lambda p: abs(p.z - 0.238)),
    ("knee_seam", lambda p: abs(p.z - 0.462) if p.y < 0.02 else 1.0),
    ("thigh_seam_l", lambda p: abs(p.x - 0.152) if 0.50 < p.z < 0.90 else 1.0),
    ("thigh_seam_r", lambda p: abs(p.x + 0.152) if 0.50 < p.z < 0.90 else 1.0),
]


def carve_seams(ob, *, width=0.0075, depth=0.0022):
    """Presses shallow seam valleys into the garment surface.

    Displacement is inward along the vertex normal with a smooth cosine
    profile, so a seam reads as a crease that catches shadow rather than as a
    groove with hard walls. Width and depth are garment-scale — about 7 mm
    across and 2 mm deep — because a seam that reads at full-body distance is
    far too heavy at close range.
    """
    me = ob.data
    normals = [Vector(v.normal) for v in me.vertices]
    moved = 0

    for i, vert in enumerate(me.vertices):
        best = width
        for _name, fn in SEAMS:
            d = fn(vert.co)
            if d < best:
                best = d
        if best < width:
            # cos profile: zero at the seam edge, full depth at its centre
            t = best / width
            amount = depth * 0.5 * (1.0 + math.cos(math.pi * t))
            vert.co = vert.co - normals[i] * amount
            moved += 1

    me.update()
    if moved == 0:
        raise meshops.MeshOperationError("seams: no vertex fell on any seam line")
    return {"seam_verts": moved}


# --- mask and lenses ---------------------------------------------------------

def build_mask(body, *, offset=0.0045, thickness=0.0035):
    """A fitted mask, built from the head region of the body itself.

    Copying the head's own surface is what makes the mask CONFORM: it is the
    head's geometry pushed out by a few millimetres and given real thickness,
    so it sits on the skull like fabric rather than like a sphere parked over
    the face. A separately modelled ellipsoid cannot follow a brow or a jaw.
    """
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()

    # Keep the head/neck cap. The lower bound sits just under the jaw so the
    # mask has somewhere to transition into the neck.
    keep = [f for f in bm.faces if f.calc_center_median().z > 1.512]
    if len(keep) < 50:
        raise meshops.MeshOperationError(f"mask: only {len(keep)} head faces found")
    doomed = [f for f in bm.faces if f not in set(keep)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")

    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * offset

    mask_me = bpy.data.meshes.new("mask")
    bm.to_mesh(mask_me)
    bm.free()

    mask = bpy.data.objects.new("SuitMask", mask_me)
    bpy.context.scene.collection.objects.link(mask)
    meshops.activate(mask)

    mod = mask.modifiers.new("solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_rim = True
    meshops.apply_modifier(mask, mod, context="mask solidify", min_ratio=1.5, max_ratio=4.0)
    meshops.shade_smooth(mask, 50)
    return mask


#: Lens outline, as a superellipse in the mask's local face plane.
#: The shape is the suit's signature: a wide, upward-swept teardrop — narrow and
#: low at the inner corner, broad and lifted at the outer. Sleek rather than
#: bug-eyed, which is what keeps it unsettling without tipping into cartoon.
def _lens_profile(t, *, width, height, sweep, power=2.2):
    """One point on the lens outline, t in [0, 1).

    The sweep term must be CONTINUOUS in x. A first version multiplied it by
    `1.0 if x > 0 else 0.35`, which steps discontinuously across the centreline
    and put a hard corner in the middle of the outline — the lens rendered as a
    crumpled quadrilateral rather than a shaped teardrop. Blending with a
    smoothstep over x removes the kink while keeping the asymmetry.
    """
    a = t * math.tau
    ct, st = math.cos(a), math.sin(a)
    # Superellipse: |x|^p + |y|^p = 1 gives a softened rectangle at p > 2,
    # which reads as a deliberately cut lens rather than a plain oval.
    x = math.copysign(abs(ct) ** (2.0 / power), ct) * width
    y = math.copysign(abs(st) ** (2.0 / power), st) * height

    u = max(0.0, min(1.0, (x / width) * 0.5 + 0.5))    # 0 at inner, 1 at outer
    bias = 0.35 + 0.65 * (u * u * (3.0 - 2.0 * u))      # smoothstep
    y += sweep * (x / width) ** 2 * bias
    return x, y


#: Measured from the built head, not assumed: at z = 1.62 the face's front
#: surface sits at y = -0.090 and the skull's half-width is 0.063. The first
#: attempt placed lenses at y = -0.055 — 3.5 cm INSIDE the head — so only their
#: outer edges surfaced, at the temples, reading as ears rather than eyes.
HEAD_FRONT_Y = -0.090
HEAD_HALF_WIDTH = 0.063


def build_lens(side, *, width=0.026, height=0.017, sweep=0.011, depth=0.010, segments=48):
    """One lens as a shaped, domed solid.

    Built in a local frame on the face and then placed, so the two lenses are
    mirror images by construction rather than by two hand-placed transforms
    that inevitably drift apart.
    """
    sign = 1.0 if side == "L" else -1.0

    bm = bmesh.new()
    rim = []
    for i in range(segments):
        lx, ly = _lens_profile(i / segments, width=width, height=height, sweep=sweep)
        rim.append(bm.verts.new((lx, 0.0, ly)))

    # Domed front: a second, smaller ring pushed forward, then a centre point.
    front = []
    for i in range(segments):
        lx, ly = _lens_profile(i / segments, width=width * 0.62, height=height * 0.62, sweep=sweep * 0.6)
        front.append(bm.verts.new((lx, -depth * 0.62, ly)))
    apex = bm.verts.new((0.0, -depth, sweep * 0.22))

    # Back plate, so the lens is a closed solid and can be booleaned safely.
    back = []
    for i in range(segments):
        lx, ly = _lens_profile(i / segments, width=width, height=height, sweep=sweep)
        back.append(bm.verts.new((lx, depth * 0.55, ly)))
    back_apex = bm.verts.new((0.0, depth * 0.75, sweep * 0.22))

    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((rim[i], rim[j], front[j], front[i]))
        bm.faces.new((front[i], front[j], apex))
        bm.faces.new((back[j], back[i], rim[i], rim[j]))
        bm.faces.new((back[i], back[j], back_apex))

    bm.normal_update()
    me = bpy.data.meshes.new(f"lens{side}")
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new(f"SuitLens{side}", me)
    bpy.context.scene.collection.objects.link(ob)

    # Seat it ON the measured face surface. Centre y is set so the front dome
    # protrudes a couple of millimetres past y = HEAD_FRONT_Y while the back
    # plate stays buried, which is what lets the socket boolean leave a rim of
    # mask fabric around the glass.
    ob.location = Vector((sign * 0.031, HEAD_FRONT_Y + depth * 0.80, 1.619))
    # Yaw wraps the lens around the skull; pitch tips it back under the brow.
    ob.rotation_euler = (math.radians(-11.0), sign * math.radians(-22.0), 0.0)

    meshops.activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    meshops.cleanup(ob)
    # Fully smooth: the dome-to-rim transition is a real curvature change, and a
    # low auto-smooth angle split it into facets that read as a crumpled shape.
    meshops.shade_smooth(ob, 180)
    return ob


def recess_lenses(mask, lenses):
    """Cuts lens sockets into the mask so the lenses sit INTO it.

    Without this the lenses are goggles resting on a face. The cutter is a
    slightly enlarged copy of each lens, so the socket leaves a visible rim of
    mask material around the glass — the detail that reads as "set into the
    fabric".
    """
    for lens in lenses:
        cutter = lens.copy()
        cutter.data = lens.data.copy()
        bpy.context.scene.collection.objects.link(cutter)
        cutter.scale = (1.045, 1.6, 1.045)
        meshops.activate(cutter)
        bpy.ops.object.transform_apply(scale=True)

        meshops.safe_boolean(mask, cutter, "DIFFERENCE", context=f"lens socket {lens.name}")
        bpy.data.objects.remove(cutter, do_unlink=True)
    return mask
