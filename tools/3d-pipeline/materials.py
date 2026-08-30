"""Suit materials.

Seven distinct materials, per the zoning requirement. Each is built from
Principled BSDF plus procedural texture nodes — no image files, so the asset
stays self-contained and the GLB carries baked-free PBR values.

The textiles are deliberately restrained. A technical weave is not shiny: its
specular is low and broad, its roughness varies slightly across the weave, and
its normal detail is fine enough to survive a close-up without turning into
rubber or stone at distance. Large procedural noise is what makes procedural
fabric read as concrete, so the weave scale here is set in real garment terms
(roughly a 1 mm thread pitch at body scale).

Weave scale is also bounded by the render: a 760-scale wave aliased into heavy
diagonal moire across the mask at QA resolution, which is worse than no weave
at all. These values hold up at both close-up and full-body framing.
"""

import bpy


def _principled(mat):
    return mat.node_tree.nodes["Principled BSDF"]


def _new(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


def _weave_normal(mat, bsdf, *, scale=520.0, strength=0.32, distortion=0.0):
    """A directional weave, built as two crossed wave textures.

    Crossed waves rather than noise: a weave is periodic and directional, and
    noise of any scale reads as grain, not as cloth.
    """
    nt = mat.node_tree
    tex_co = nt.nodes.new("ShaderNodeTexCoord")

    warp = nt.nodes.new("ShaderNodeTexWave")
    warp.wave_type = "BANDS"
    warp.bands_direction = "X"
    warp.inputs["Scale"].default_value = scale
    warp.inputs["Distortion"].default_value = distortion

    weft = nt.nodes.new("ShaderNodeTexWave")
    weft.wave_type = "BANDS"
    weft.bands_direction = "Y"
    weft.inputs["Scale"].default_value = scale
    weft.inputs["Distortion"].default_value = distortion

    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    mix.blend_type = "OVERLAY"
    mix.inputs["Factor"].default_value = 0.5

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.0008

    nt.links.new(tex_co.outputs["Object"], warp.inputs["Vector"])
    nt.links.new(tex_co.outputs["Object"], weft.inputs["Vector"])
    nt.links.new(warp.outputs["Fac"], mix.inputs[2])
    nt.links.new(weft.outputs["Fac"], mix.inputs[3])
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    # Roughness varies slightly with the weave, so highlights break up the way
    # they do on real cloth instead of sliding across a uniform surface.
    rough_mix = nt.nodes.new("ShaderNodeMapRange")
    rough_mix.inputs["From Min"].default_value = 0.0
    rough_mix.inputs["From Max"].default_value = 1.0
    nt.links.new(mix.outputs[0], rough_mix.inputs["Value"])
    return rough_mix


def _textile(name, colour, *, roughness=0.62, sheen=0.30, scale=520.0, strength=0.32):
    mat = _new(name)
    bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.42
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
        bsdf.inputs["Sheen Roughness"].default_value = 0.35
    rough = _weave_normal(mat, bsdf, scale=scale, strength=strength)
    rough.inputs["To Min"].default_value = max(roughness - 0.07, 0.05)
    rough.inputs["To Max"].default_value = min(roughness + 0.07, 0.98)
    mat.node_tree.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def build_materials(primary=(0.021, 0.024, 0.041), panel=(0.128, 0.014, 0.026), accent=(0.010, 0.011, 0.015)):
    """The seven-material set. Returns a dict keyed by role."""
    mats = {}

    # 1-3: the garment textiles.
    mats["TEXTILE"] = _textile("vox_textile_primary", primary, roughness=0.66, sheen=0.18, scale=300.0)
    mats["PANEL"] = _textile("vox_textile_panel", panel, roughness=0.57, sheen=0.16, scale=250.0, strength=0.30)
    mats["ACCENT"] = _textile("vox_textile_accent", accent, roughness=0.48, sheen=0.18, scale=340.0, strength=0.22)

    # 4: mask fabric — finer weave, slightly tighter response than the body.
    mats["MASK"] = _textile("vox_mask_fabric", (0.128, 0.016, 0.028), roughness=0.52, sheen=0.26, scale=380.0, strength=0.16)

    # 5: lens — dark, sharply reflective, and the one place a mirror finish
    # belongs. Not emissive: a glowing lens reads as a prop, a reflective one
    # reads as glass over a dark interior.
    lens = _new("vox_lens")
    bsdf = _principled(lens)
    bsdf.inputs["Base Color"].default_value = (0.006, 0.007, 0.010, 1.0)
    # A near-mirror lens reflects the whole area light and renders as a flat
    # white shape — the opposite of the intended dark, sleek read. A little
    # roughness and no metalness keeps a tight, moving highlight instead.
    bsdf.inputs["Roughness"].default_value = 0.13
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.52
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.85
        bsdf.inputs["Coat Roughness"].default_value = 0.03
    mats["LENS"] = lens

    # 6: mechanical polymer — the housing and trigger.
    poly = _new("vox_polymer")
    bsdf = _principled(poly)
    bsdf.inputs["Base Color"].default_value = (0.026, 0.028, 0.034, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.36
    bsdf.inputs["Metallic"].default_value = 0.10
    mats["POLYMER"] = poly

    # 7: machined metal — the mechanism and nozzle.
    metal = _new("vox_metal")
    bsdf = _principled(metal)
    bsdf.inputs["Base Color"].default_value = (0.62, 0.64, 0.68, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.26
    bsdf.inputs["Metallic"].default_value = 1.0
    mats["METAL"] = metal

    # The cartridge reads as a consumable: a warmer, anodised aluminium.
    cart = _new("vox_cartridge")
    bsdf = _principled(cart)
    bsdf.inputs["Base Color"].default_value = (0.52, 0.30, 0.11, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.30
    bsdf.inputs["Metallic"].default_value = 0.90
    mats["CARTRIDGE"] = cart

    return mats
