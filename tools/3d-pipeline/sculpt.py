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
    Muscle("pectoral",      (0.056, -0.088, 1.268), (0.078, 0.060, 0.062), 0.017),
    Muscle("pec_upper",     (0.052, -0.080, 1.318), (0.070, 0.055, 0.040), 0.009),
    Muscle("sternum",       (0.000, -0.098, 1.250), (0.030, 0.045, 0.085), -0.006, mirror=False),
    Muscle("abdominal",     (0.030, -0.080, 1.120), (0.050, 0.050, 0.090), 0.008),
    Muscle("linea_alba",    (0.000, -0.086, 1.105), (0.014, 0.045, 0.095), -0.007, mirror=False),
    Muscle("oblique",       (0.078, -0.040, 1.090), (0.045, 0.060, 0.075), 0.007),
    Muscle("waist_hollow",  (0.092,  0.000, 1.058), (0.045, 0.085, 0.055), -0.010),

    # --- torso, back --------------------------------------------------------
    Muscle("trapezius",     (0.052,  0.030, 1.372), (0.090, 0.060, 0.075), 0.013),
    Muscle("scapula",       (0.078,  0.058, 1.290), (0.060, 0.045, 0.070), 0.010),
    Muscle("spinal_furrow", (0.000,  0.048, 1.230), (0.016, 0.050, 0.170), -0.009, mirror=False),
    Muscle("latissimus",    (0.098,  0.030, 1.195), (0.055, 0.070, 0.090), 0.011),
    Muscle("lumbar",        (0.034,  0.040, 1.070), (0.045, 0.045, 0.060), 0.007),

    # --- shoulder / arm -----------------------------------------------------
    Muscle("deltoid_cap",   (0.178, -0.010, 1.372), (0.062, 0.070, 0.070), 0.014),
    Muscle("deltoid_rear",  (0.168,  0.040, 1.360), (0.050, 0.050, 0.060), 0.008),
    Muscle("biceps",        (0.206, -0.030, 1.250), (0.045, 0.040, 0.070), 0.010),
    Muscle("triceps",       (0.212,  0.038, 1.255), (0.045, 0.040, 0.080), 0.009),
    Muscle("brachio",       (0.238, -0.020, 1.020), (0.040, 0.042, 0.065), 0.008),
    Muscle("forearm_flex",  (0.246,  0.030, 1.015), (0.038, 0.038, 0.060), 0.007),

    # --- pelvis / leg -------------------------------------------------------
    Muscle("gluteus",       (0.062,  0.072, 0.905), (0.072, 0.055, 0.080), 0.019),
    Muscle("glute_fold",    (0.066,  0.055, 0.845), (0.070, 0.045, 0.022), -0.008),
    Muscle("hip_flexor",    (0.070, -0.060, 0.900), (0.050, 0.045, 0.060), 0.007),
    Muscle("quadriceps",    (0.098, -0.058, 0.700), (0.062, 0.050, 0.115), 0.013),
    Muscle("vastus_lat",    (0.140,  0.000, 0.690), (0.040, 0.060, 0.105), 0.009),
    Muscle("hamstring",     (0.098,  0.062, 0.690), (0.060, 0.045, 0.110), 0.010),
    Muscle("knee_cap",      (0.104, -0.052, 0.500), (0.042, 0.030, 0.048), 0.008),
    Muscle("popliteal",     (0.104,  0.046, 0.498), (0.040, 0.028, 0.038), -0.007),
    Muscle("gastroc",       (0.104,  0.052, 0.392), (0.050, 0.042, 0.085), 0.013),
    Muscle("tibia_ridge",   (0.098, -0.040, 0.300), (0.022, 0.030, 0.110), 0.005),

    # --- head / neck --------------------------------------------------------
    Muscle("sterno",        (0.030, -0.036, 1.492), (0.026, 0.030, 0.048), 0.006),
    Muscle("occiput",       (0.000,  0.046, 1.648), (0.055, 0.040, 0.055), 0.008, mirror=False),
    Muscle("brow",          (0.000, -0.070, 1.632), (0.070, 0.030, 0.022), 0.007, mirror=False),
    Muscle("cheek",         (0.046, -0.056, 1.590), (0.036, 0.040, 0.040), 0.008),
    Muscle("temple",        (0.070,  0.000, 1.626), (0.030, 0.045, 0.045), -0.006),
    Muscle("chin",          (0.000, -0.060, 1.556), (0.032, 0.030, 0.030), 0.007, mirror=False),
    Muscle("jaw_line",      (0.052, -0.024, 1.560), (0.030, 0.045, 0.026), 0.006),
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
