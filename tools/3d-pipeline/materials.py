"""Suit materials.

Nine distinct materials, per the zoning requirement. Each is built from
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


#: Defaults in LINEAR space, matching the palette build_suit.py ships.
#:
#: These used to be a saturated red panel and a red mask over a blue body,
#: which — with a web pattern and a full-head mask — is a recognisable
#: copyrighted costume. The suit's design language is tonal graphite and slate
#: instead. The mask default in particular mattered: the body and mask meshes
#: have their procedural material replaced by a baked one, so a stale colour
#: there was invisible, but the bezel keeps its procedural material and would
#: have rendered as a red frame on a slate mask.
DEFAULT_PRIMARY = (0.037, 0.041, 0.058)
DEFAULT_PANEL = (0.093, 0.109, 0.155)
DEFAULT_ACCENT = (0.014, 0.016, 0.021)
DEFAULT_MASK = (0.030, 0.037, 0.055)


def build_materials(primary=DEFAULT_PRIMARY, panel=DEFAULT_PANEL,
                    accent=DEFAULT_ACCENT, mask=DEFAULT_MASK):
    """The material set. Returns a dict keyed by role."""
    mats = {}

    # 1-3: the garment textiles.
    mats["TEXTILE"] = _textile("vox_textile_primary", primary, roughness=0.66, sheen=0.18, scale=300.0)
    mats["PANEL"] = _textile("vox_textile_panel", panel, roughness=0.57, sheen=0.16, scale=250.0, strength=0.30)
    mats["ACCENT"] = _textile("vox_textile_accent", accent, roughness=0.48, sheen=0.18, scale=340.0, strength=0.22)

    # 4: mask fabric — finer weave, slightly tighter response than the body.
    mats["MASK"] = _textile("vox_mask_fabric", mask, roughness=0.52, sheen=0.26, scale=380.0, strength=0.16)

    # 4b: lens bezel — the same colour as the mask but bonded, not knitted, so
    # it is darker and appreciably smoother. That contrast is what makes the
    # frame read as a separate component holding the glass rather than as a
    # fold in the fabric.
    bezel = _new("vox_lens_bezel")
    bsdf = _principled(bezel)
    bsdf.inputs["Base Color"].default_value = (*(c * 0.62 for c in mask), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.31
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.45
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.25
        bsdf.inputs["Coat Roughness"].default_value = 0.18
    mats["BEZEL"] = bezel

    # 4c: boot sole — moulded rubber. Darker than the garment and noticeably
    # rougher: a sole is the one surface on a suit that is deliberately matte,
    # and giving it the textile's sheen would make it read as more fabric,
    # which is exactly the problem it exists to solve.
    sole = _new("vox_sole")
    bsdf = _principled(sole)
    bsdf.inputs["Base Color"].default_value = (0.011, 0.012, 0.014, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.74
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.48
    mats["SOLE"] = sole

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
    # Gunmetal, not chrome. At 0.62/0.26 the mechanism read as bright polished
    # steel and pulled the eye away from the suit — hardware on a wearable is
    # anodised or bead-blasted, never mirror-finished.
    bsdf.inputs["Base Color"].default_value = (0.185, 0.195, 0.215, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["Metallic"].default_value = 1.0
    mats["METAL"] = metal

    # The cartridge reads as a consumable: a warmer, anodised aluminium.
    cart = _new("vox_cartridge")
    bsdf = _principled(cart)
    bsdf.inputs["Base Color"].default_value = (0.42, 0.24, 0.085, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.36
    bsdf.inputs["Metallic"].default_value = 0.90
    mats["CARTRIDGE"] = cart

    return mats
