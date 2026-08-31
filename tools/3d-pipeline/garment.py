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


#: Where the lens sits, as ANGLES around the head rather than as a position.
#:
#: A lens spans about 50 mm of face, and over that span the mask surface falls
#: away by 20 mm — measured, not guessed: at the eye line the mask front is at
#: y = -0.101 on the centreline and -0.080 at x = 45 mm. A flat plate placed by
#: one location + rotation therefore cannot sit on the face. Both failure modes
#: happened: seat it to touch the outer end and the inner end floats off the
#: bridge; seat it to touch the inner end and everything outboard is swallowed,
#: leaving only the temples poking out, which reads as ears rather than eyes.
#:
#: So the lens is projected onto the mask's real surface, the same trick that
#: makes build_mask() conform: cast a ray at each outline point and offset along
#: the surface normal. Yaw/pitch are the natural parameters for that, because
#: they wrap around the skull by construction.
LENS_YAW = math.radians(25.0)      # centre of the lens, out from the centreline
LENS_PITCH = math.radians(1.0)     # centre of the lens, up from the eye line
#: Arc length -> angle. Roughly the head's radius in each axis, so `width` and
#: `height` below stay readable as millimetres on the face.
HEAD_YAW_RADIUS = 0.076
HEAD_PITCH_RADIUS = 0.098
#: Head centre, in the plane the rays fan out from. Measured from the built
#: mask, not assumed — see _head_pivot().
LENS_CAST_DISTANCE = 0.45


def _head_pivot(surface):
    """The centre the lens rays fan out from: the mask's own head centroid."""
    pts = [v.co for v in surface.data.vertices if v.co.z > 1.545]
    if len(pts) < 40:
        raise meshops.MeshOperationError(f"lens frame: only {len(pts)} head verts on {surface.name}")
    total = Vector((0.0, 0.0, 0.0))
    for p in pts:
        total += p
    return total / len(pts)


def _face_point(surface, depsgraph, pivot, yaw, pitch):
    """Where a ray at (yaw, pitch) meets the mask, and the surface normal there.

    Rays fan out from the head's centroid, so they strike the face close to
    head-on even out at the temple, where a straight -y cast would graze the
    surface and land somewhere arbitrary.
    """
    d = Vector((
        math.sin(yaw) * math.cos(pitch),
        -math.cos(yaw) * math.cos(pitch),
        math.sin(pitch),
    ))
    origin = pivot + d * LENS_CAST_DISTANCE
    ok, loc, nor, _idx = surface.ray_cast(origin, -d, depsgraph=depsgraph)
    if not ok:
        raise meshops.MeshOperationError(
            f"lens: no face surface at yaw {math.degrees(yaw):.1f}deg pitch {math.degrees(pitch):.1f}deg"
        )
    # The cast hits the outer shell first, so the normal already points out of
    # the mask; flip only if the mesh disagrees.
    if nor.dot(d) < 0.0:
        nor = -nor
    return loc, nor.normalized()


def _smooth_ring(points, passes=5, factor=0.55):
    """Low-pass a closed loop of points.

    The mask is ~1800 faces over a whole head, so a 64-point outline projected
    straight onto it inherits every facet: the rendered lens rim came out
    visibly dented and lopsided, which reads as a melted blob rather than as a
    manufactured optic. Averaging each point toward its two neighbours removes
    the tessellation frequency and leaves the designed curve. The few tenths of
    a millimetre this moves the rim off the surface is irrelevant — the lens
    penetrates the shell by 20 mm either way.
    """
    n = len(points)
    out = list(points)
    for _ in range(passes):
        out = [
            out[i] + (out[(i - 1) % n] + out[(i + 1) % n] - out[i] * 2.0) * (factor * 0.5)
            for i in range(n)
        ]
    return out


def _ring_points(surface, depsgraph, pivot, sign, scale, lift, *, width, height, sweep, segments):
    """One smoothed loop of the lens outline, projected onto the mask."""
    pts = []
    for i in range(segments):
        px, pz = _lens_profile(
            i / segments,
            width=width * scale,
            height=height * scale,
            sweep=sweep * scale,
        )
        # px is signed outward-from-inner-corner, so the sign flip mirrors the
        # asymmetric sweep along with the placement.
        yaw = sign * (LENS_YAW + px / HEAD_YAW_RADIUS)
        pitch = LENS_PITCH + pz / HEAD_PITCH_RADIUS
        loc, nor = _face_point(surface, depsgraph, pivot, yaw, pitch)
        pts.append(loc + nor * lift)
    return _smooth_ring(pts)


def _conform_lens(surface, depsgraph, pivot, side, mesh_name, object_name, *,
                  width, height, sweep, profile_scale, proud, dome, back, segments):
    """A lens-shaped solid laid onto the mask surface.

    Four rings: the rim on the surface, a smaller ring lifted for the dome, an
    apex, and a back plate buried inside the head so the solid is closed and
    safe to boolean. Every ring is built from ray hits, so all four follow the
    face's curvature instead of approximating it with a plane.
    """
    sign = 1.0 if side == "L" else -1.0

    def ring(bm, scale, lift):
        verts = _ring_points(surface, depsgraph, pivot, sign, scale, lift,
                             width=width, height=height, sweep=sweep, segments=segments)
        return [bm.verts.new(p) for p in verts]

    bm = bmesh.new()
    s = profile_scale
    rim = ring(bm, s, proud)
    front = ring(bm, s * 0.58, proud + dome * 0.74)

    centre_loc, centre_nor = _face_point(surface, depsgraph, pivot, sign * LENS_YAW, LENS_PITCH)
    apex = bm.verts.new(centre_loc + centre_nor * (proud + dome))

    outer = ring(bm, s, -back)
    back_apex = bm.verts.new(centre_loc - centre_nor * (back * 1.15))

    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((rim[i], rim[j], front[j], front[i]))
        bm.faces.new((front[i], front[j], apex))
        bm.faces.new((outer[j], outer[i], rim[i], rim[j]))
        bm.faces.new((outer[i], outer[j], back_apex))

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalc_face_normals makes the winding CONSISTENT, not necessarily
    # outward: on a shallow dished solid like this it settled on inside-out,
    # which renders as a hole in the face under backface culling. Signed volume
    # is the unambiguous test, so use it rather than trusting the operator.
    if bm.calc_volume(signed=True) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(mesh_name)
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new(object_name, me)
    bpy.context.scene.collection.objects.link(ob)
    meshops.cleanup(ob)
    # Fully smooth: the dome-to-rim transition is a real curvature change, and a
    # low auto-smooth angle split it into facets that read as a crumpled shape.
    meshops.shade_smooth(ob, 180)
    return ob


def _conform_bezel(surface, depsgraph, pivot, side, mesh_name, object_name, *,
                   width, height, sweep, inner, outer, lip, flush, drop, segments):
    """The frame the lens sits in: a raised band following the lens outline.

    Without it a lens is a black shape erupting out of plain fabric, with no
    account of how it is held — which is most of what separates a piece of
    equipment from a sticker. A real mask carries a bonded or stitched
    surround, so this is an annulus, not a disc: four loops, inner and outer,
    top and bottom, welded into a closed band.
    """
    sign = 1.0 if side == "L" else -1.0
    kw = dict(width=width, height=height, sweep=sweep, segments=segments)

    def ring(scale, lift):
        return _ring_points(surface, depsgraph, pivot, sign, scale, lift, **kw)

    # Top face rises from flush at the outer edge to a lip against the glass,
    # so the frame reads as a bevel rather than as a flat washer.
    a = ring(inner, lip)        # inner top, against the lens
    b = ring(outer, flush)      # outer top, meeting the fabric
    c = ring(outer, -drop)      # outer underside, buried
    d = ring(inner, -drop)      # inner underside, buried

    bm = bmesh.new()
    loops = [[bm.verts.new(p) for p in loop] for loop in (a, b, c, d)]
    for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 0)):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((loops[lo][i], loops[lo][j], loops[hi][j], loops[hi][i]))

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(mesh_name)
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new(object_name, me)
    bpy.context.scene.collection.objects.link(ob)
    meshops.cleanup(ob)
    # A hard crease along the four loops, soft around them: the bevel edges are
    # real edges and should catch a highlight as a line.
    meshops.shade_smooth(ob, 42)
    return ob


def build_lenses(mask, *, width=0.0262, height=0.0172, sweep=0.0092,
                 proud=0.0016, dome=0.0048, back=0.020, segments=64):
    """Both lenses and their bezels, seated into the mask.

    Returns `(lenses, bezels)`. The bezels are frame geometry and carry the
    mask's material, not the lens material, so they are kept separate.

    `width`/`height` are HALF-extents, so the defaults are a 52 x 34 mm lens —
    brow to cheekbone, bridge to temple, on a mask measuring 148 mm across.
    (A pass that read them as full extents and doubled them produced a 115 mm
    lens on a 148 mm head: the two crossed the nose, overlapped each other and
    hung off the sides of the skull.)

    NO CSG. The lens is a closed solid whose rim stands `proud` above the mask
    surface and whose back plate is buried 20 mm inside the skull, so it passes
    THROUGH the shell and the fabric hides everything below the rim. Two opaque
    interpenetrating solids already render as one set into the other; cutting a
    socket adds nothing you can see and a whole failure mode you can't.

    That failure mode was real. An earlier version cut sockets with a boolean —
    or rather, appeared to: it copied each lens, called transform_apply(
    location=True) first (which moves the origin to the world origin) and then
    set `cutter.scale`, so the scale was applied about (0, 0, 0) rather than
    about the lens. A 1.045 factor on a part sitting at z = 1.62 displaced the
    cutter 73 mm upward, into the forehead, where it intersected nothing. The
    boolean was therefore a silent no-op that still passed its own validation,
    which is why the lenses never looked recessed. Aiming the cutter correctly
    then exposed a second problem: EXACT-solver DIFFERENCE against this mask
    shell is unreliable in both directions — it deleted all 1840 faces for the
    socket and changed nothing at all for a plain test cube. Geometry that does
    not depend on the solver is the better answer.
    """
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    pivot = _head_pivot(mask)

    lenses, bezels = [], []
    for side in ("L", "R"):
        lenses.append(_conform_lens(
            mask, depsgraph, pivot, side, f"lens{side}", f"SuitLens{side}",
            width=width, height=height, sweep=sweep,
            profile_scale=1.0, proud=proud, dome=dome, back=back, segments=segments,
        ))
        # Inner loop tucks just under the lens rim so no gap opens between
        # frame and glass; outer loop lands 4 mm out on the fabric.
        bezels.append(_conform_bezel(
            mask, depsgraph, pivot, side, f"lensBezel{side}", f"SuitLensBezel{side}",
            width=width, height=height, sweep=sweep,
            inner=0.985, outer=1.16, lip=proud + 0.0011, flush=0.0003,
            drop=0.006, segments=segments,
        ))
    return lenses, bezels


# --- boot sole ---------------------------------------------------------------
#
# Why this exists at all: without it the foot renders as a smooth rounded blob —
# a sock, or at best a wellington. A sole is the single feature that makes a
# covered foot read as FOOTWEAR, because it is the one part of a shoe whose
# shape is dictated by the ground rather than by the foot: a flat tread, a
# sidewall with a real thickness, and an arch that lifts clear between heel and
# forefoot.
#
# Every dimension below comes from casting rays at the BUILT foot rather than
# from anatomy.SIDE_JOINTS. The joint values are nominal: the Skin modifier and
# the subdivision that follows shrink them, unevenly and by a lot, so a sole
# derived from the joint numbers fits a foot that does not exist.

#: Where the footprint is measured, in metres above the ground.
#:
#: The measurement height matters more than it looks. Two hand-written width
#: tables failed here in a row, and both failed the same way: the numbers came
#: from the foot's WIDEST section, but the foot is an ellipsoid and has already
#: narrowed a long way by the time it reaches sole height. The sole therefore
#: overhung by 15-20 mm all round and rendered as a flip-flop with a boot
#: standing on it. Trimming the table by 13% moved the problem without solving
#: it, because the taper is not uniform along the foot.
#:
#: So the footprint is no longer written down at all. It is MEASURED off the
#: built foot at the height the sole actually meets it, the same way the mask
#: gets its lens positions and for the same reason: a number derived from the
#: geometry cannot drift away from the geometry.
#: Several heights, and the WIDEST hit at each station wins.
#:
#: One height is not enough. The foot's section changes fast near the ground,
#: so a footprint measured at a single z came out narrower than the foot
#: standing on it: the upper visibly overhung its own sole and the sole read as
#: a thin paddle slipped underneath. A sole covers the widest part of what it
#: carries, so the measurement has to as well.
SOLE_MEASURE_HEIGHTS = (0.009, 0.014, 0.020, 0.027)
#: How far the sole stands proud of the upper. A real boot sole: 3-6 mm.
SOLE_MARGIN = 0.0052


def _measure_footprint(body, depsgraph, side, *, samples=120):
    """The foot's own outline at sole height, as (y, lateral_x, medial_x).

    ABSOLUTE x, not a half-width about an assumed centreline. The foot does not
    sit centred on its own joint chain — measured, its lateral edge is 18 mm out
    from x = 0.106 while its medial edge is 37 mm in — so a sole built
    symmetrically about that constant hangs off one side and cuts into the
    other.

    Two horizontal casts per station: one inward from outboard, one outward
    from the gap between the feet. The medial ray starts at x = +/-0.030 rather
    than further in, because the two feet are only 212 mm apart and an origin
    much nearer the centreline lands INSIDE the other foot.
    """
    sign = 1.0 if side == "L" else -1.0

    stations = []
    for i in range(samples):
        y = -0.220 + (0.400 * i / (samples - 1))
        lat_x = med_x = None
        for z in SOLE_MEASURE_HEIGHTS:
            lateral = body.ray_cast(
                Vector((sign * 0.300, y, z)), Vector((-sign, 0.0, 0.0)), depsgraph=depsgraph
            )
            medial = body.ray_cast(
                Vector((sign * 0.030, y, z)), Vector((sign, 0.0, 0.0)), depsgraph=depsgraph
            )
            if not lateral[0] or not medial[0]:
                continue
            if abs(lateral[1].x - medial[1].x) < 0.008:
                # A grazing hit at the very tip returns a sliver: that is the
                # ray clipping a corner, not a real section.
                continue
            # Outermost wins on each side independently — the foot leans, so
            # its widest lateral point and widest medial point need not be at
            # the same height.
            if lat_x is None or abs(lateral[1].x) > abs(lat_x):
                lat_x = lateral[1].x
            if med_x is None or abs(medial[1].x) < abs(med_x):
                med_x = medial[1].x
        if lat_x is None or med_x is None:
            continue
        stations.append((y, lat_x, med_x))

    if len(stations) < 12:
        raise meshops.MeshOperationError(
            f"sole {side}: only {len(stations)} footprint stations found"
        )
    return stations


def _lerp_table(table, t):
    """Piecewise-linear lookup with a smoothstep blend, clamped at both ends."""
    if t <= table[0][0]:
        return table[0][1]
    if t >= table[-1][0]:
        return table[-1][1]
    for (t0, v0), (t1, v1) in zip(table, table[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return v0 + (v1 - v0) * (f * f * (3.0 - 2.0 * f))
    return table[-1][1]


def _sole_top_z(y):
    """Where the sole's top face sits — inside the foot, deliberately.

    Same reasoning as the lens: the sole is an opaque solid overlapping an
    opaque foot, so burying its top face means the join needs no CSG and
    cannot leave a seam.
    """
    return 0.0112 + 0.0032 * max(0.0, min(1.0, (y + 0.05) / 0.15))


def _sole_bottom_z(y):
    """Ground under heel and forefoot, lifted through the arch."""
    forefoot = max(0.0, min(1.0, (-0.040 - y) / 0.040))
    heel = max(0.0, min(1.0, (y - 0.020) / 0.035))
    contact = max(forefoot, heel)
    return 0.0068 * (1.0 - contact * contact * (3.0 - 2.0 * contact))


def build_sole(body, side, *, segments=96, wall=0.0030, inset=0.0040, toe_spring=0.0052):
    """One bonded sole: sidewall, arch and tread, as a closed solid.

    Three loops — a buried top, the outer sidewall bottom, and an inset tread —
    plus caps. The tread loop is inset from the sidewall so the ground edge is a
    bevel rather than a square corner, which is what makes it catch a highlight
    along its whole length and read as moulded rubber.

    THIN, and no rand. A pass with a raised rand wrapping up the upper made it
    worse in two ways at once. The rand loop is a plan-view footprint scaled and
    lifted vertically, but the foot's cross-section changes shape along its
    length, so at the waist the loop pinched inward and cut a deep V-notch into
    the side of the sole. And the extra height took the whole assembly to 25-30
    mm of visible rubber, which reads as a platform clog — the opposite end of
    the range from the fitted technical garment this suit is. A thin bonded sole
    under a bootie upper is both the correct silhouette for the design and the
    one that needs no geometry the footprint cannot express.
    """
    sign = 1.0 if side == "L" else -1.0

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    stations = _measure_footprint(body, depsgraph, side)
    lateral_table = [(y, lat) for y, lat, _med in stations]
    medial_table = [(y, med) for y, _lat, med in stations]
    centre_table = [(y, (lat + med) * 0.5) for y, lat, med in stations]
    y_toe, y_heel = stations[0][0], stations[-1][0]

    def sole_y(t):
        """Walk the outline: heel to toe down one side, back up the other.

        Ends are extended past the measured range so the sole covers the toe
        and heel, which the horizontal casts cannot reach — a ray at the very
        tip grazes the surface and returns nothing usable. The toe needs the
        larger extension: it tips up, so it leaves the measurement height a
        long way back from where it actually ends, and a sole cut at the last
        measured station stops 45 mm short with the toes hanging over the front.
        """
        lo, hi = y_toe - 0.032, y_heel + 0.008
        if t < 0.5:
            return hi + (lo - hi) * (t * 2.0), +1.0
        return lo + (hi - lo) * ((t - 0.5) * 2.0), -1.0

    def outline(shrink, lift_fn):
        pts = []
        for i in range(segments):
            y, lateral = sole_y(i / segments)
            edge = _lerp_table(lateral_table if lateral > 0 else medial_table, y)
            centre = _lerp_table(centre_table, y)
            half = abs(edge - centre) + SOLE_MARGIN - shrink
            # Round the ends off, so the sole is a shape rather than a slab cut
            # square across the toe and heel. sqrt gives a full round rather
            # than the point a linear taper leaves.
            taper = min(
                1.0,
                max(0.0, (y - (y_toe - 0.032)) / 0.046),
                max(0.0, ((y_heel + 0.008) - y) / 0.020),
            )
            half *= math.sqrt(max(taper, 0.0))
            x = centre + sign * lateral * max(half, 0.0012)
            # Toe spring: the front of the sole lifts off the ground, as every
            # shoe does, so the toe is not a flat edge butted into the floor.
            spring = toe_spring * max(0.0, min(1.0, (y_toe + 0.020 - y) / 0.048)) ** 2
            pts.append(Vector((x, y, lift_fn(y) + spring)))
        # Same treatment as the lens rim, for the same reason. Each station is
        # an independent ray hit on a subdivided surface, and the toe and heel
        # are extrapolated past the last one, so the raw loop carries both
        # per-station noise and a visible step where the extrapolation meets
        # the measurements. Low-passing the closed loop removes both and costs
        # a few tenths of a millimetre of fit, which the margin already covers.
        return _smooth_ring(pts, passes=6, factor=0.6)

    top = outline(0.0, _sole_top_z)
    outer = outline(0.0, lambda y: _sole_bottom_z(y) + wall)
    tread = outline(inset, _sole_bottom_z)

    bm = bmesh.new()
    loops = [[bm.verts.new(p) for p in loop] for loop in (top, outer, tread)]
    for lo, hi in ((0, 1), (1, 2)):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((loops[lo][i], loops[lo][j], loops[hi][j], loops[hi][i]))

    for loop, points in ((loops[0], top), (loops[2], tread)):
        centre = Vector((0.0, 0.0, 0.0))
        for p in points:
            centre += p
        hub = bm.verts.new(centre / len(points))
        for i in range(segments):
            bm.faces.new((loop[i], loop[(i + 1) % segments], hub))

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(f"sole{side}")
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new(f"SuitSole{side}", me)
    bpy.context.scene.collection.objects.link(ob)
    meshops.cleanup(ob)
    # A low angle on purpose: the sidewall-to-tread bevel and the top edge are
    # hard edges on a real sole and should stay hard.
    meshops.shade_smooth(ob, 34)
    return ob
