"""Anatomical sculpting as displacement fields.

Skin + subdivision gives correct topology and continuous junctions, but very
soft forms: the base body has a correct silhouette and no muscle definition at
all, which is why it still reads as a mannequin in profile. Bounding-box depth
was already right — what was missing was surface form for light to describe.

This layer adds that. Each muscle is an ellipsoidal influence field; vertices
inside it move along their own normal, weighted by a smooth falloff. That is
sculpting expressed as code: repeatable, reviewable in a diff, and adjustable by
editing a number rather than by re-doing brush strokes.

Falloff is (1 - d²)², which reaches zero value AND zero gradient at the field
boundary, so a muscle blends into the surrounding surface instead of leaving the
tide-mark a linear falloff produces.
"""

import bpy
from mathutils import Vector

import meshops


class Muscle:
    """One ellipsoidal displacement field.

    `centre` is world-space, `radii` are the ellipsoid's semi-axes, `strength`
    is the peak displacement in metres along the vertex normal (negative pulls
    in, which is how creases and the waist hollow are made).
    """

    __slots__ = ("name", "centre", "radii", "strength", "mirror")

    def __init__(self, name, centre, radii, strength, mirror=True):
        self.name = name
        self.centre = Vector(centre)
        self.radii = Vector(radii)
        self.strength = strength
        self.mirror = mirror

    def instances(self):
        yield self.centre, self.radii, self.strength
        if self.mirror and abs(self.centre.x) > 1e-6:
            mirrored = Vector((-self.centre.x, self.centre.y, self.centre.z))
            yield mirrored, self.radii, self.strength


#: The figure's muscle layer. Values are metres on a 1.75 m body.
#: Ordered head-down purely for readability; fields are additive, so order
#: does not affect the result.
MUSCLES = [
    # --- torso, front -------------------------------------------------------
    Muscle("pectoral",      (0.060, -0.096, 1.270), (0.084, 0.064, 0.066), 0.023),
    Muscle("pec_upper",     (0.052, -0.080, 1.318), (0.070, 0.055, 0.040), 0.009),
    Muscle("sternum",       (0.000, -0.098, 1.250), (0.030, 0.045, 0.085), -0.006, mirror=False),
    Muscle("abdominal",     (0.030, -0.080, 1.120), (0.050, 0.050, 0.090), 0.008),
    Muscle("linea_alba",    (0.000, -0.086, 1.105), (0.014, 0.045, 0.095), -0.007, mirror=False),
    Muscle("oblique",       (0.078, -0.040, 1.090), (0.045, 0.060, 0.075), 0.007),
    Muscle("waist_hollow",  (0.092,  0.000, 1.058), (0.045, 0.085, 0.055), -0.010),

    # --- torso, back --------------------------------------------------------
    Muscle("trapezius",     (0.056,  0.032, 1.374), (0.096, 0.064, 0.080), 0.017),
    Muscle("scapula",       (0.078,  0.058, 1.290), (0.060, 0.045, 0.070), 0.010),
    Muscle("spinal_furrow", (0.000,  0.048, 1.230), (0.016, 0.050, 0.170), -0.009, mirror=False),
    Muscle("latissimus",    (0.108,  0.030, 1.198), (0.060, 0.076, 0.098), 0.016),
    Muscle("lumbar",        (0.034,  0.040, 1.070), (0.045, 0.045, 0.060), 0.007),

    # --- shoulder / arm -----------------------------------------------------
    Muscle("deltoid_cap",   (0.192, -0.010, 1.370), (0.070, 0.078, 0.078), 0.021),
    Muscle("deltoid_rear",  (0.168,  0.040, 1.360), (0.050, 0.050, 0.060), 0.008),
    Muscle("biceps",        (0.214, -0.034, 1.250), (0.048, 0.044, 0.074), 0.015),
    Muscle("triceps",       (0.220,  0.042, 1.255), (0.048, 0.044, 0.084), 0.013),
    Muscle("brachio",       (0.238, -0.020, 1.020), (0.040, 0.042, 0.065), 0.008),
    Muscle("forearm_flex",  (0.246,  0.030, 1.015), (0.038, 0.038, 0.060), 0.007),

    # --- pelvis / leg -------------------------------------------------------
    Muscle("gluteus",       (0.062,  0.072, 0.905), (0.072, 0.055, 0.080), 0.019),
    Muscle("glute_fold",    (0.066,  0.055, 0.845), (0.070, 0.045, 0.022), -0.008),
    Muscle("hip_flexor",    (0.070, -0.060, 0.900), (0.050, 0.045, 0.060), 0.007),
    Muscle("quadriceps",    (0.100, -0.066, 0.700), (0.066, 0.054, 0.120), 0.018),
    Muscle("vastus_lat",    (0.140,  0.000, 0.690), (0.040, 0.060, 0.105), 0.009),
    Muscle("hamstring",     (0.098,  0.062, 0.690), (0.060, 0.045, 0.110), 0.010),
    Muscle("knee_cap",      (0.104, -0.052, 0.500), (0.042, 0.030, 0.048), 0.008),
    Muscle("popliteal",     (0.104,  0.046, 0.498), (0.040, 0.028, 0.038), -0.007),
    Muscle("gastroc",       (0.104,  0.058, 0.394), (0.054, 0.046, 0.090), 0.018),
    Muscle("tibia_ridge",   (0.098, -0.040, 0.300), (0.022, 0.030, 0.110), 0.005),

    # --- shoulder girdle landmarks ------------------------------------------
    Muscle("clavicle",      (0.070, -0.062, 1.392), (0.070, 0.030, 0.018), 0.009),
    Muscle("clavicle_hollow", (0.048, -0.058, 1.418), (0.040, 0.028, 0.020), -0.008),
    Muscle("serratus",      (0.096, -0.030, 1.170), (0.030, 0.050, 0.055), 0.007),
    Muscle("lat_insertion", (0.106,  0.010, 1.268), (0.036, 0.055, 0.055), 0.008),

    # --- head / neck --------------------------------------------------------
    Muscle("sterno",        (0.030, -0.036, 1.492), (0.026, 0.030, 0.048), 0.006),
    Muscle("trap_neck",     (0.036,  0.028, 1.462), (0.045, 0.038, 0.050), 0.008),

    # --- face ----------------------------------------------------------------
    # A MASKED head, not a sculpted face.
    #
    # The first attempt at this used tight fields at 0.010-0.014 — which the
    # global sculpt scale multiplies to 20-30 mm — and rendered a grotesque:
    # brow ridges like shelves, a lumpy chin, bulging cheeks. Two lessons are
    # baked into the values below. Adjacent tight fields SUM where they overlap,
    # so their peaks compound into ridges; and displacement along the normal of
    # an already-curved surface amplifies rather than blends.
    #
    # So: fewer fields, roughly twice the radius, and a third of the strength.
    #
    # That correction then overshot in the other direction. Everything landed at
    # 5-9 mm after the 2.1 scale, and a rendered front view showed the result
    # honestly: below the lenses the mask was a blank ovoid with no nose, no
    # jaw and no chin — an egg, which is exactly the mannequin read the whole
    # asset is trying to escape. A nose projects 20-25 mm on a real face and a
    # fitted mask does not hide it; 9 mm is not a subtle nose, it is no nose.
    #
    # So the fields are now sized by what they represent rather than by a
    # uniform timidity. The features a mask genuinely smooths over — lips,
    # nostrils, eyelids — stay absent, because modelling those only fights the
    # garment sitting on top. The features that carry a face's structure are
    # given their real projection.
    Muscle("occiput",       (0.000,  0.048, 1.648), (0.070, 0.050, 0.070), 0.0040, mirror=False),
    Muscle("forehead",      (0.000, -0.066, 1.664), (0.072, 0.044, 0.048), 0.0030, mirror=False),
    # Third correction, and the one that resolved it. Scaling every field up
    # together did not produce a face — it produced two swollen cheek pouches
    # and a chin like a bulb, with the nose no more visible than before, because
    # a nose only reads by CONTRAST with what surrounds it. Raising its
    # neighbours by the same proportion cancels exactly the thing being fixed.
    #
    # So the mid-face is deliberately held back below where it started, and only
    # the two features whose absence made the head an egg — the nose ridge and
    # the chin — are given real projection. The cheekbone in particular is now a
    # narrow ridge under the eye rather than a 46 mm sphere, which is what it
    # was when it dominated the whole side of the face.
    Muscle("brow_ridge",    (0.030, -0.072, 1.640), (0.052, 0.038, 0.024), 0.0044),
    # Deeper than the brow is proud: the socket is what gives the lens
    # somewhere to sit, instead of the lens sitting on a flat cheek.
    Muscle("eye_socket",    (0.034, -0.066, 1.618), (0.038, 0.034, 0.026), -0.0044),
    # Nose as a RIDGE, in two parts. One ellipsoid gives a rounded lump; a
    # narrow bridge running down into a stronger tip gives the wedge that
    # actually reads, and the two summing along the midline is the intended
    # shape rather than an accident.
    # NARROW. A 40 mm-wide tip field at 19 mm projection rendered a muzzle: the
    # nose read as one broad mound running from the lenses to the mouth and
    # merging into both cheeks. A nose is narrow — about 25 mm across the tip —
    # and its width is what decides whether it reads as human or as a snout.
    Muscle("nose_bridge",   (0.000, -0.078, 1.628), (0.013, 0.022, 0.034), 0.0050, mirror=False),
    Muscle("nose_tip",      (0.000, -0.085, 1.596), (0.0145, 0.024, 0.017), 0.0082, mirror=False),
    # Negative, and placed hard against the nose: the crease beside the nostril
    # is what actually separates a nose from a cheek. Adding a positive wing
    # field here instead just merged the two into one mass.
    Muscle("nose_crease",   (0.019, -0.074, 1.588), (0.014, 0.018, 0.020), -0.0044),
    # And a cut underneath it, so the nose ends somewhere instead of flowing
    # down into the upper lip.
    Muscle("nose_under",    (0.000, -0.078, 1.577), (0.019, 0.019, 0.011), -0.0034, mirror=False),
    Muscle("cheekbone",     (0.050, -0.058, 1.612), (0.033, 0.036, 0.023), 0.0028),
    Muscle("cheek_hollow",  (0.044, -0.062, 1.574), (0.036, 0.040, 0.032), -0.0034),
    # The mouth is a plane, not a mouth: enough to stop the lower face reading
    # as flat, with nothing a mask would not show.
    Muscle("mouth",         (0.000, -0.077, 1.566), (0.029, 0.024, 0.016), 0.0015, mirror=False),
    Muscle("chin",          (0.000, -0.075, 1.538), (0.026, 0.029, 0.024), 0.0056, mirror=False),
    Muscle("jaw_angle",     (0.056, -0.016, 1.556), (0.032, 0.046, 0.032), 0.0034),
    Muscle("temple",        (0.064, -0.024, 1.644), (0.034, 0.050, 0.046), -0.0028),

    # --- finger joints -------------------------------------------------------
    # Small positive bumps on the knuckle and middle joints of each finger.
    #
    # The skeleton already tapers each finger from knuckle to tip, so the
    # fingers separate correctly and read as four plus a thumb. What they do
    # NOT read as is jointed: a taper alone gives four smooth tubes, and the
    # rendered close-up showed exactly that. Real fingers are widest AT the
    # joints, and that alternation of swell and waist is the whole cue. These
    # land at 2-3 mm after the scale, which is the real thing.
    Muscle("knuckle_i_j",   (0.262, -0.031, 0.782), (0.011, 0.011, 0.012), 0.0013),
    Muscle("knuckle_m_j",   (0.263, -0.010, 0.779), (0.011, 0.011, 0.012), 0.0013),
    Muscle("knuckle_r_j",   (0.263,  0.011, 0.782), (0.011, 0.011, 0.012), 0.0012),
    Muscle("knuckle_p_j",   (0.262,  0.030, 0.789), (0.010, 0.010, 0.011), 0.0011),
    Muscle("mid_i_j",       (0.263, -0.033, 0.746), (0.010, 0.010, 0.011), 0.0011),
    Muscle("mid_m_j",       (0.264, -0.011, 0.740), (0.010, 0.010, 0.011), 0.0011),
    Muscle("mid_r_j",       (0.264,  0.012, 0.745), (0.010, 0.010, 0.011), 0.0010),
    Muscle("mid_p_j",       (0.263,  0.032, 0.757), (0.009, 0.009, 0.010), 0.0009),
]


def apply_muscles(ob, muscles=None, *, scale=1.0):
    """Displaces the mesh by the summed muscle fields.

    Displacement is accumulated per-vertex first and applied afterwards, so
    every field is evaluated against the SAME original surface. Applying each
    muscle immediately would make the result depend on the order of the list,
    and overlapping fields would compound into spikes.
    """
    muscles = MUSCLES if muscles is None else muscles
    me = ob.data
    me.calc_loop_triangles()

    normals = [Vector(v.normal) for v in me.vertices]
    offsets = [0.0] * len(me.vertices)

    fields = []
    for muscle in muscles:
        for centre, radii, strength in muscle.instances():
            fields.append((centre, radii, strength * scale))

    for i, vert in enumerate(me.vertices):
        co = vert.co
        total = 0.0
        for centre, radii, strength in fields:
            dx = (co.x - centre.x) / radii.x
            dy = (co.y - centre.y) / radii.y
            dz = (co.z - centre.z) / radii.z
            d2 = dx * dx + dy * dy + dz * dz
            if d2 >= 1.0:
                continue
            falloff = (1.0 - d2)
            total += strength * falloff * falloff
        offsets[i] = total

    moved = 0
    for i, vert in enumerate(me.vertices):
        if offsets[i]:
            vert.co = vert.co + normals[i] * offsets[i]
            moved += 1

    if moved == 0:
        raise meshops.MeshOperationError(
            "sculpt: no vertex was displaced — the muscle fields miss the mesh entirely"
        )

    peak = max(abs(o) for o in offsets)
    if peak > 0.10:
        raise meshops.MeshOperationError(
            f"sculpt: peak displacement {peak:.3f} m is implausible — fields are overlapping"
        )

    me.update()
    return {"displaced": moved, "of": len(me.vertices), "peak": round(peak, 4)}


def relax(ob, iterations=2, factor=0.35):
    """A light smoothing pass to settle field boundaries.

    Kept deliberately weak: heavy smoothing would undo the definition the
    muscle layer just added, which is the opposite of the point.
    """
    meshops.activate(ob)
    mod = ob.modifiers.new("relax", "SMOOTH")
    mod.iterations = iterations
    mod.factor = factor
    return meshops.apply_modifier(ob, mod, context="sculpt relax", min_ratio=0.99, max_ratio=1.01)
