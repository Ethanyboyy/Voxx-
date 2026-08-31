"""Render rigs and the QA view set.

Two rigs, deliberately separate:

DIAGNOSTIC is the one that matters during modelling. Neutral, even, slightly
cool fill with a clear key — chosen so silhouette, topology-derived shading,
material boundaries and seams are all legible. It is not flattering and is not
meant to be.

CINEMATIC is only for the final presentation frame, and is never used to judge
the asset. The first version of this pipeline ran a 900 W key that blew every
material to identical featureless grey; overexposure destroys exactly the
information a QA render exists to show.
"""

import math
import os

import bpy
from mathutils import Vector


def _area(name, location, energy, size, rotation, color=(1.0, 1.0, 1.0)):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.size = size
    data.color = color
    ob = bpy.data.objects.new(name, data)
    ob.location = location
    ob.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(ob)
    return ob


def clear_lights():
    for ob in [o for o in bpy.context.scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(ob, do_unlink=True)


def diagnostic_rig():
    """Even, neutral, honest. Energies are metres-aware: these are ~2-3 m from
    a 1.75 m subject, where a few hundred watts is a correct exposure."""
    clear_lights()
    _area("key", (2.0, -2.4, 2.1), 220, 2.2, (0.98, 0.0, 0.68))
    _area("fill", (-2.4, -1.8, 1.5), 90, 3.0, (1.20, 0.0, -0.95))
    _area("rim", (-0.6, 2.6, 2.2), 150, 2.0, (-1.05, 0.0, -0.25))
    # A dim top light separates the crown of the head from the background
    # without adding a second specular the eye has to discount.
    _area("top", (0.0, -0.2, 3.0), 60, 2.5, (0.0, 0.0, 0.0))

    world = bpy.data.worlds.new("diagnostic")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.052, 0.06, 1.0)
    bpy.context.scene.world = world


def cinematic_rig(accent=(0.30, 0.10, 0.55)):
    """Presentation only. Never judge geometry under this."""
    clear_lights()
    _area("key", (2.1, -2.5, 2.2), 260, 1.4, (0.98, 0.0, 0.68))
    _area("fill", (-2.6, -1.6, 1.3), 45, 3.2, (1.22, 0.0, -1.02))
    _area("rim_l", (-1.9, 2.2, 2.0), 320, 1.0, (-1.02, 0.0, -0.62), color=(0.62, 0.70, 1.0))
    _area("rim_r", (2.2, 1.9, 1.7), 260, 0.9, (-1.05, 0.0, 0.72), color=(1.0, 0.42, 0.38))
    _area("kick", (0.0, -1.4, 0.25), 40, 1.6, (-1.35, 0.0, 0.0), color=accent)

    world = bpy.data.worlds.new("cinematic")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.013, 0.018, 1.0)
    bpy.context.scene.world = world


#: name → (camera location, look-at point, focal length mm)
#: Long lenses on the close-ups: a wide lens at close range distorts the very
#: proportions these frames exist to check.
VIEWS = {
    # Full-body framing is arithmetic, not taste. Blender fits the 36 mm sensor
    # to the LARGER render dimension, which is height in these portrait frames,
    # so vertical coverage is 2·d·tan(atan(18/f)). At 85 mm and 3.3 m that is
    # 1.40 m — a 1.71 m figure cannot fit, and the head was cropped off every
    # full-body view. 60 mm at 3.55 m gives 2.1 m, which frames a 1.71 m figure with a
    # sensible margin. 4.4 m was the first correction and overshot — the figure
    # floated in empty frame, which hides detail just as effectively as a crop.
    "front":          ((0.00, -3.55, 0.88), (0.0, 0.0, 0.88), 60),
    "side":           ((3.55,  0.00, 0.88), (0.0, 0.0, 0.88), 60),
    "rear":           ((0.00,  3.55, 0.88), (0.0, 0.0, 0.88), 60),
    "three_quarter":  ((2.45, -2.55, 1.02), (0.0, 0.0, 0.88), 60),
    "head":           ((0.42, -0.95, 1.62), (0.0, -0.02, 1.60), 110),
    # Dead-on, because symmetry cannot be judged from a three-quarter: one lens
    # is foreshortened there and a genuine left/right mismatch is impossible to
    # tell apart from perspective.
    "face":           ((0.00, -0.86, 1.62), (0.0, -0.02, 1.61), 110),
    "mask_lens":      ((0.26, -0.62, 1.60), (0.0, -0.05, 1.60), 135),
    "web_shooter":    ((0.60, -0.55, 0.93), (0.252, 0.0, 0.90), 135),
    "hand":           ((0.62, -0.52, 0.78), (0.262, 0.0, 0.77), 135),
    "foot":           ((0.55, -0.62, 0.16), (0.106, -0.03, 0.07), 110),
    "torso":          ((1.20, -1.45, 1.25), (0.0, 0.0, 1.20), 100),
    "cinematic":      ((2.15, -2.95, 1.25), (0.0, 0.0, 0.90), 65),
}


def render_views(out_dir, names, *, samples=48, resolution=640, subdir="renders"):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = int(resolution * 1.35)
    scene.render.image_settings.file_format = "PNG"

    cam_data = bpy.data.cameras.new("qa_cam")
    cam = bpy.data.objects.new("qa_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    target_dir = os.path.join(out_dir, subdir)
    os.makedirs(target_dir, exist_ok=True)

    paths = []
    for name in names:
        location, look_at, lens = VIEWS[name]
        cam_data.lens = lens
        cam.location = Vector(location)
        cam.rotation_euler = (Vector(look_at) - Vector(location)).to_track_quat("-Z", "Y").to_euler()

        path = os.path.join(target_dir, f"{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
        print(f"RENDER {path}", flush=True)

    bpy.data.objects.remove(cam, do_unlink=True)
    return paths
