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
    "ribs":        (0.000, -0.010, 1.155, 0.116, 0.118),
    "chest":       (0.000, -0.014, 1.255, 0.142, 0.126),
    "clavicle":    (0.000, -0.008, 1.395, 0.152, 0.112),
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
    "shoulder":    (0.150, -0.006, 1.412, 0.074, 0.072),
    "deltoid":     (0.196, -0.002, 1.368, 0.068, 0.066),
    "biceps":      (0.214,  0.004, 1.245, 0.052, 0.050),
    "elbow":       (0.228,  0.008, 1.108, 0.042, 0.043),
    "forearm":     (0.242,  0.012, 1.010, 0.047, 0.045),
    "wrist":       (0.256,  0.016, 0.876, 0.027, 0.022),

    # --- hand ---------------------------------------------------------------
    "palm":        (0.259,  0.014, 0.822, 0.040, 0.020),
    "knuckle_i":   (0.261, -0.020, 0.782, 0.019, 0.016),
    "knuckle_m":   (0.263, -0.004, 0.778, 0.019, 0.016),
    "knuckle_r":   (0.263,  0.012, 0.782, 0.018, 0.015),
    "knuckle_p":   (0.261,  0.027, 0.792, 0.016, 0.014),
    "tip_i":       (0.261, -0.031, 0.714, 0.013, 0.011),
    "tip_m":       (0.263, -0.011, 0.706, 0.013, 0.011),
    "tip_r":       (0.263,  0.013, 0.714, 0.012, 0.011),
    "tip_p":       (0.261,  0.032, 0.734, 0.011, 0.010),
    "thumb_base":  (0.250, -0.026, 0.812, 0.019, 0.017),
    "thumb_tip":   (0.238, -0.054, 0.772, 0.013, 0.012),

    # --- leg: hip → thigh → knee → calf → ankle ------------------------------
    "hip":         (0.090,  0.008, 0.882, 0.094, 0.100),
    "thigh":       (0.100,  0.004, 0.700, 0.082, 0.088),
    "above_knee":  (0.104,  0.008, 0.560, 0.063, 0.068),
    "knee":        (0.106,  0.010, 0.492, 0.057, 0.061),
    "calf":        (0.106,  0.014, 0.390, 0.060, 0.064),
    "shin":        (0.106,  0.014, 0.250, 0.041, 0.046),
    "ankle":       (0.106,  0.016, 0.098, 0.032, 0.036),

    # --- foot ---------------------------------------------------------------
    "heel":        (0.106,  0.062, 0.042, 0.034, 0.040),
    "arch":        (0.106, -0.020, 0.038, 0.038, 0.048),
    "forefoot":    (0.106, -0.088, 0.036, 0.040, 0.046),
    "toe":         (0.106, -0.128, 0.028, 0.034, 0.030),
}

SIDE_BONES = [
    ("shoulder", "deltoid"),
    ("deltoid", "biceps"),
    ("biceps", "elbow"),
    ("elbow", "forearm"),
    ("forearm", "wrist"),
    ("wrist", "palm"),
    # Fingers branch off separate knuckles rather than all from one vertex:
    # a five-way branch at a single point produces tangled skin geometry, and
    # separate knuckles are what actually reads as a hand.
    ("palm", "knuckle_i"),
    ("palm", "knuckle_m"),
    ("palm", "knuckle_r"),
    ("palm", "knuckle_p"),
    ("knuckle_i", "tip_i"),
    ("knuckle_m", "tip_m"),
    ("knuckle_r", "tip_r"),
    ("knuckle_p", "tip_p"),
    ("palm", "thumb_base"),
    ("thumb_base", "thumb_tip"),

    ("hip", "thigh"),
    ("thigh", "above_knee"),
    ("above_knee", "knee"),
    ("knee", "calf"),
    ("calf", "shin"),
    ("shin", "ankle"),
    ("ankle", "heel"),
    ("ankle", "arch"),
    ("arch", "forefoot"),
    ("forefoot", "toe"),
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
