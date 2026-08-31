"""The figure's skeleton graph — joints, connectivity and per-joint thickness.

This is the model's real parameter set. Everything about the silhouette is
here, so the shape can be revised by editing numbers rather than by rewriting
geometry code.

Coordinates are Blender's: Z is up, and the figure faces -Y (the glTF exporter
maps Blender -Y to glTF +Z, and the runtime armour rig derives character-left as
+X on the assumption the body faces +Z).

Units are metres on a 1.75 m figure. Proportions are ordinary published
anthropometric ratios — biacromial breadth ~0.23 H, upper arm ~0.186 H, forearm
~0.146 H, hand ~0.108 H — applied consistently rather than tuned to flatter a
particular camera angle.

Each joint carries an elliptical radius (rx, ry). Two radii rather than one is
what lets a torso be wider than it is deep and a wrist be flatter than it is
broad; a single radius everywhere is most of what makes procedural figures read
as pipe-work.
"""

# name: (x, y, z, rx, ry)
# +X is character-left. -Y is forward (the direction the figure faces).
# The y column carries the spine's real S-curve: buttocks back, lumbar forward,
# chest forward, and it is what stops the figure reading as a flat plank in
# profile. The first pass had depth of 0.22 m on a 1.71 m figure — a human is
# 0.25–0.30 m deep at the chest — and the side view showed it immediately.
CENTRE_JOINTS = {
    # No separate crotch joint. A chain END below the pelvis hangs as a lobe
    # between the legs and creases into a hard V — clearly visible as a dark
    # angular fold in the three-quarter view. Letting the legs branch straight
    # off the pelvis lets SKIN close that junction properly.
    "pelvis":      (0.000,  0.014, 0.918, 0.114, 0.120),
    "waist":       (0.000, -0.006, 1.055, 0.094, 0.098),
    "ribs":        (0.000, -0.010, 1.155, 0.126, 0.128),
    "chest":       (0.000, -0.014, 1.258, 0.156, 0.136),
    "clavicle":    (0.000, -0.008, 1.398, 0.166, 0.122),
    "neck_base":   (0.000, -0.004, 1.470, 0.054, 0.056),
    "neck_top":    (0.000, -0.008, 1.528, 0.049, 0.052),
    "jaw":         (0.000, -0.020, 1.576, 0.068, 0.082),
    "cranium":     (0.000, -0.004, 1.650, 0.080, 0.092),
    "skull_top":   (0.000,  0.004, 1.714, 0.047, 0.054),
}

CENTRE_BONES = [
    ("pelvis", "waist"),
    ("waist", "ribs"),
    ("ribs", "chest"),
    ("chest", "clavicle"),
    ("clavicle", "neck_base"),
    ("neck_base", "neck_top"),
    ("neck_top", "jaw"),
    ("jaw", "cranium"),
    ("cranium", "skull_top"),
]

# Mirrored onto both sides. x is written for character-LEFT and negated for right.
SIDE_JOINTS = {
    # --- arm: shoulder → upper arm → elbow → forearm → wrist -----------------
    # Biacromial breadth ~0.23 H puts the deltoid's outer edge near x = 0.20.
    # The first pass sat at 0.176 and read narrow-shouldered against a wide
    # pelvis — the single most damaging proportion error in a hero silhouette.
    "shoulder":    (0.158, -0.006, 1.412, 0.082, 0.080),
    "deltoid":     (0.207, -0.002, 1.366, 0.078, 0.076),
    "biceps":      (0.222,  0.004, 1.245, 0.061, 0.059),
    "elbow":       (0.234,  0.008, 1.108, 0.047, 0.048),
    "forearm":     (0.246,  0.012, 1.006, 0.055, 0.052),
    "wrist":       (0.256,  0.016, 0.876, 0.029, 0.024),

    # --- hand ---------------------------------------------------------------
    # Rebuilt from measured proportions after the clay render showed four fused
    # sausages and a thumb larger than the palm. Two structural errors, both
    # fixed here:
    #
    # 1. The palm's radii were (0.040, 0.020) — WIDE in X. With the arm hanging
    #    and the palm facing the thigh, hand BREADTH runs front-to-back (Y) and
    #    thickness runs across (X). The pair was simply transposed, which is why
    #    the hand read as a flat paddle turned the wrong way.
    # 2. Each finger was ONE segment, knuckle to tip, so it could only ever be a
    #    tube. A finger needs three phalanges with falling radii to read as a
    #    finger at all.
    #
    # Radii were also roughly double life size: a proximal phalanx is ~19 mm
    # across, so the radius is ~9.5 mm, not the 19 mm that was there.
    "palm":        (0.261,  0.010, 0.834, 0.018, 0.040),
    "palm_low":    (0.262,  0.006, 0.804, 0.0165, 0.041),

    # Knuckle row, spread across the hand's breadth (Y). Index forward.
    "knuckle_i":   (0.262, -0.031, 0.782, 0.0092, 0.0092),
    "knuckle_m":   (0.263, -0.010, 0.779, 0.0096, 0.0096),
    "knuckle_r":   (0.263,  0.011, 0.782, 0.0090, 0.0090),
    "knuckle_p":   (0.262,  0.030, 0.789, 0.0078, 0.0078),

    # Middle phalanges — the joint that makes a finger read as jointed.
    "mid_i":       (0.263, -0.033, 0.746, 0.0082, 0.0082),
    "mid_m":       (0.264, -0.011, 0.740, 0.0086, 0.0086),
    "mid_r":       (0.264,  0.012, 0.745, 0.0080, 0.0080),
    "mid_p":       (0.263,  0.032, 0.757, 0.0069, 0.0069),

    # Distal phalanges. Middle finger longest, pinky shortest — equal-length
    # fingers are one of the loudest tells of an unmodelled hand.
    "tip_i":       (0.263, -0.034, 0.716, 0.0062, 0.0060),
    "tip_m":       (0.264, -0.012, 0.708, 0.0065, 0.0063),
    "tip_r":       (0.264,  0.013, 0.716, 0.0060, 0.0058),
    "tip_p":       (0.263,  0.033, 0.733, 0.0052, 0.0051),

    # Thumb: opposed, off the radial side of the palm, and much smaller than it
    # was. Two segments plus a metacarpal root.
    "thumb_root":  (0.257, -0.016, 0.826, 0.0135, 0.0135),
    "thumb_base":  (0.250, -0.044, 0.802, 0.0102, 0.0102),
    "thumb_tip":   (0.244, -0.060, 0.777, 0.0072, 0.0070),

    # --- leg: hip → thigh → knee → calf → ankle ------------------------------
    "hip":         (0.090,  0.008, 0.882, 0.094, 0.100),
    "thigh":       (0.101,  0.004, 0.700, 0.092, 0.098),
    "above_knee":  (0.104,  0.008, 0.560, 0.070, 0.076),
    "knee":        (0.106,  0.010, 0.492, 0.062, 0.066),
    "calf":        (0.106,  0.014, 0.392, 0.069, 0.073),
    "shin":        (0.106,  0.014, 0.250, 0.045, 0.050),
    "ankle":       (0.106,  0.016, 0.098, 0.034, 0.038),

    # --- foot ---------------------------------------------------------------
    # AXIS NOTE, and it is the whole reason the foot kept reading wrong: the
    # skin modifier's two radii lie in the plane PERPENDICULAR to the bone. The
    # foot chain runs along Y, so its radii map to X (width) and **Z (height)**
    # — not to X and Y as they do on the vertical spine and limb chains.
    #
    # The second value was therefore setting foot HEIGHT, and 0.036 made the
    # ball of the foot 72 mm tall. A real foot is ~40 mm there. That is why it
    # read as an inflated slipper no matter how the length was adjusted.
    # The heel is a chain TERMINAL, and the Skin modifier's end cap plus
    # Catmull-Clark pull a terminal in hard — far harder than a mid-chain node.
    # At the previous (z 0.036, height radius 0.030) the nominal underside was
    # 6 mm but the BUILT surface came out at 37 mm, while the ball sat at 6 mm.
    # The figure was standing on tiptoe in a permanent 3 cm heel rise, which no
    # amount of sole work could disguise: the sole lay flat on the floor with
    # the heel floating a finger's width above it.
    #
    # Measured by casting straight down over the foot's length and sweeping
    # these two numbers until the heel's underside matched the ball's. Nominal
    # values below ground are correct and intended — the shrink is what brings
    # them back up.
    "heel":        (0.104,  0.074, 0.010, 0.031, 0.054),
    "instep":      (0.105,  0.014, 0.052, 0.032, 0.032),
    "arch":        (0.106, -0.020, 0.034, 0.037, 0.026),
    "ball":        (0.107, -0.082, 0.028, 0.048, 0.022),
    "toe":         (0.107, -0.128, 0.022, 0.042, 0.015),
}

SIDE_BONES = [
    ("shoulder", "deltoid"),
    ("deltoid", "biceps"),
    ("biceps", "elbow"),
    ("elbow", "forearm"),
    ("forearm", "wrist"),
    ("wrist", "palm"),
    # The palm is a two-vertex slab, not a point. Branching four fingers off a
    # single vertex crowds the skin solver and fuses them; spreading the branch
    # across a short palm segment gives each knuckle its own room.
    ("palm", "palm_low"),
    ("palm_low", "knuckle_i"),
    ("palm_low", "knuckle_m"),
    ("palm_low", "knuckle_r"),
    ("palm_low", "knuckle_p"),
    # Three phalanges each — proximal, middle, distal.
    ("knuckle_i", "mid_i"), ("mid_i", "tip_i"),
    ("knuckle_m", "mid_m"), ("mid_m", "tip_m"),
    ("knuckle_r", "mid_r"), ("mid_r", "tip_r"),
    ("knuckle_p", "mid_p"), ("mid_p", "tip_p"),
    # Thumb branches off the palm's radial side, not off the knuckle row.
    ("palm", "thumb_root"),
    ("thumb_root", "thumb_base"),
    ("thumb_base", "thumb_tip"),

    ("hip", "thigh"),
    ("thigh", "above_knee"),
    ("above_knee", "knee"),
    ("knee", "calf"),
    ("calf", "shin"),
    ("shin", "ankle"),
    # The instep sits between ankle and arch so the top of the foot has a real
    # rise; heel branches back from the ankle, giving a proper heel-to-ground
    # contact instead of a rounded stump.
    ("ankle", "heel"),
    ("ankle", "instep"),
    ("instep", "arch"),
    ("arch", "ball"),
    ("ball", "toe"),
]

# Bones joining a mirrored limb to the spine.
ATTACHMENTS = [
    ("clavicle", "shoulder"),
    ("pelvis", "hip"),
]

# The Skin modifier needs exactly one root vertex; the pelvis is the natural
# one, being the only joint every limb chain reaches through.
ROOT_JOINT = "pelvis"

#: Anatomical zones, used for garment material assignment. Each entry is a
#: predicate over a world-space point, evaluated in order — first match wins.
#: Zones follow the body rather than being arbitrary panels, which is the
#: difference between a tailored garment and armour plates stuck onto a figure.
ZONE_ORDER = [
    "LENS",
    "MASK",
    "GLOVE",
    "BOOT",
    "KNEE",
    "CHEST",
    "PANEL",
    "TEXTILE",
]
