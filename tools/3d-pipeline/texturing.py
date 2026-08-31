"""Baked PBR texture generation — base colour, roughness, tangent-space normal.

This is the stage the previous pass identified as missing, and it is the fix for
the defect that kept the asset non-production: garment zones were assigned per
FACE, so every panel boundary quantised to ~1 cm polygons and read as ragged
colour-blocking. No amount of subdivision fixes that — it trades 4x triangles
per level for a linear improvement in a boundary that is still polygonal.

The approach here is a position bake done in Python rather than through
Blender's bake operator:

  1. Rasterise every UV triangle, interpolating world position and normal, to
     get a per-TEXEL map of where each point of the texture lives in 3D.
  2. Evaluate the garment design analytically at each texel — zones, web
     pattern, weave — at texture resolution rather than mesh resolution.
  3. Write base colour, roughness and a tangent-space normal derived from the
     height field.

Doing it in Python rather than with shader nodes matters for one hard reason:
Blender's procedural texture nodes DO NOT SURVIVE glTF EXPORT. A suit that
looks right in Cycles and arrives in the browser as flat colour is not a
delivered asset. Baked image textures do export, so what Cycles renders and
what the Suit Bay loads are the same surface.
"""

import math
import os
import tempfile

import bpy
import numpy as np

import meshops


# --- small analytic helpers --------------------------------------------------

def sstep(edge0, edge1, x):
    """Smoothstep — the reason boundaries here are soft instead of stair-stepped."""
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _hash31(ix, iy, iz):
    """Deterministic per-cell jitter. Integer hashing keeps the pattern stable
    across rebuilds — a web that reshuffles every run is not a design."""
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    a = ((h ^ (h >> 16)) & 0xFFFF) / 65535.0
    h2 = (h * 2654435761) & 0xFFFFFFFF
    b = ((h2 ^ (h2 >> 16)) & 0xFFFF) / 65535.0
    h3 = (h2 * 40503) & 0xFFFFFFFF
    c = ((h3 ^ (h3 >> 16)) & 0xFFFF) / 65535.0
    return a, b, c


# --- rasterisation -----------------------------------------------------------

def rasterize_attributes(ob, size):
    """Per-texel world position and normal, by rasterising the UV layout.

    This is what makes the whole module possible: it inverts the UV mapping, so
    an analytic function of 3D position can be evaluated per texel. Returns
    (position, normal, coverage) with coverage marking texels any triangle
    actually covered.
    """
    me = ob.data
    me.calc_loop_triangles()
    uv_layer = me.uv_layers.active
    if uv_layer is None:
        raise meshops.MeshOperationError(f"{ob.name} has no UV layer to bake against")

    n_loops = len(me.loops)
    uvs = np.empty(n_loops * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(n_loops, 2)

    n_verts = len(me.vertices)
    co = np.empty(n_verts * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n_verts, 3)
    nrm = np.empty(n_verts * 3, dtype=np.float32)
    me.vertices.foreach_get("normal", nrm)
    nrm = nrm.reshape(n_verts, 3)

    tris = me.loop_triangles
    n_tris = len(tris)
    tri_loops = np.empty(n_tris * 3, dtype=np.int32)
    tris.foreach_get("loops", tri_loops)
    tri_loops = tri_loops.reshape(n_tris, 3)
    tri_verts = np.empty(n_tris * 3, dtype=np.int32)
    tris.foreach_get("vertices", tri_verts)
    tri_verts = tri_verts.reshape(n_tris, 3)

    position = np.zeros((size, size, 3), dtype=np.float32)
    normal = np.zeros((size, size, 3), dtype=np.float32)
    coverage = np.zeros((size, size), dtype=bool)

    # Texel centres, in UV space.
    tri_uv = uvs[tri_loops] * size - 0.5
    tri_co = co[tri_verts]
    tri_nr = nrm[tri_verts]

    for i in range(n_tris):
        a, b, c = tri_uv[i]
        min_x = max(int(math.floor(min(a[0], b[0], c[0]))), 0)
        max_x = min(int(math.ceil(max(a[0], b[0], c[0]))), size - 1)
        min_y = max(int(math.floor(min(a[1], b[1], c[1]))), 0)
        max_y = min(int(math.ceil(max(a[1], b[1], c[1]))), size - 1)
        if max_x < min_x or max_y < min_y:
            continue

        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(det) < 1e-12:
            continue

        ys, xs = np.mgrid[min_y:max_y + 1, min_x:max_x + 1]
        px = xs.astype(np.float32)
        py = ys.astype(np.float32)

        w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
        w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
        w2 = 1.0 - w0 - w1
        # A small negative tolerance closes the hairline cracks between
        # adjacent triangles that exact edge tests leave behind.
        inside = (w0 >= -0.002) & (w1 >= -0.002) & (w2 >= -0.002)
        if not inside.any():
            continue

        wi = np.stack([w0[inside], w1[inside], w2[inside]], axis=-1)
        position[ys[inside], xs[inside]] = wi @ tri_co[i]
        normal[ys[inside], xs[inside]] = wi @ tri_nr[i]
        coverage[ys[inside], xs[inside]] = True

    return position, normal, coverage


def dilate(image, coverage, iterations=6):
    """Bleeds covered texels outward so bilinear filtering never samples the gap
    between UV islands, which otherwise shows as dark seams on the model."""
    out = image.copy()
    filled = coverage.copy()
    for _ in range(iterations):
        if filled.all():
            break
        acc = np.zeros_like(out)
        count = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted = np.roll(filled, (dy, dx), axis=(0, 1))
            shifted_img = np.roll(out, (dy, dx), axis=(0, 1))
            take = shifted & ~filled
            acc[take] += shifted_img[take]
            count[take] += 1.0
        grew = count > 0
        out[grew] = acc[grew] / count[grew][..., None]
        filled |= grew
    return out


# --- the garment design, evaluated per texel ---------------------------------

def web_distance(position, scale=52.0, jitter=0.70):
    """Distance-to-edge of a jittered 3D Voronoi — the web net.

    A Voronoi cell boundary is used rather than a drawn grid because the net has
    to wrap a body continuously. Evaluated in WORLD space, so it crosses UV
    island boundaries without a visible break and holds a constant real-world
    cell size over the whole garment — which a UV-space pattern cannot do when
    the unwrap is not area-preserving.
    """
    p = position * scale
    base = np.floor(p).astype(np.int32)
    frac = p - base

    best1 = np.full(position.shape[:2], 1e9, dtype=np.float32)
    best2 = np.full(position.shape[:2], 1e9, dtype=np.float32)

    for oz in (-1, 0, 1):
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                cell = base + np.array((ox, oy, oz), dtype=np.int32)
                jx, jy, jz = _hash31(cell[..., 0], cell[..., 1], cell[..., 2])
                # Jitter trades regularity for organic variation. Pulled hard
                # toward the cell centres (0.28) the cells become large and
                # sparse and read as widely-spaced cracks, which was worse than
                # where it started; 0.70 keeps a web-like irregular net.
                #
                # Cell SIZE is bounded from BOTH ends and that is the real
                # constraint. At scale 44 (2.3 cm) the net read as crazed glaze
                # close up; at scale 74 (1.4 cm) it went sub-pixel and vanished
                # entirely in a full-body frame. 52 (~1.9 cm) is the size that
                # survives a close-up and still reads at hero distance.
                jx = 0.5 + (jx - 0.5) * jitter
                jy = 0.5 + (jy - 0.5) * jitter
                jz = 0.5 + (jz - 0.5) * jitter
                offset = np.stack([
                    ox + jx - frac[..., 0],
                    oy + jy - frac[..., 1],
                    oz + jz - frac[..., 2],
                ], axis=-1)
                d = np.linalg.norm(offset, axis=-1)
                closer = d < best1
                best2 = np.where(closer, best1, np.minimum(best2, d))
                best1 = np.where(closer, d, best1)

    # |F2 - F1| is small exactly on a cell boundary — the web strand.
    return np.abs(best2 - best1)


def triplanar_weave(position, normal, scale=1750.0):
    """A directional weave, blended triplanar so thread size stays constant.

    Crossed sine bands, not noise: a weave is periodic and directional, and
    noise of any scale reads as grain or concrete rather than cloth.
    """
    w = np.abs(normal) ** 4.0
    w = w / (w.sum(axis=-1, keepdims=True) + 1e-9)

    x, y, z = position[..., 0] * scale, position[..., 1] * scale, position[..., 2] * scale
    warp_x = np.sin(y) + np.sin(z)
    warp_y = np.sin(x) + np.sin(z)
    warp_z = np.sin(x) + np.sin(y)
    return (warp_x * w[..., 0] + warp_y * w[..., 1] + warp_z * w[..., 2]) * 0.5


def zone_weights(position):
    """Smooth garment-zone masks, evaluated per texel.

    Same anatomical curves the per-face version used, but returned as SOFT
    weights: a boundary now transitions over a few millimetres of real surface
    instead of snapping at a polygon edge. That single change is what turns
    colour-blocking into something that reads as a cut and stitched panel.
    """
    x, y, z = position[..., 0], position[..., 1], position[..., 2]
    ax = np.abs(x)
    blend = 0.006  # metres of transition — roughly a stitched seam allowance

    glove = sstep(0.892 + y * 0.35 + blend, 0.892 + y * 0.35 - blend, z) * sstep(0.178, 0.192, ax)
    boot = sstep(0.252 + y * 0.42 + blend, 0.252 + y * 0.42 - blend, z)

    yoke_lower = 1.036 + 0.150 * np.clip(ax / 0.180, 0.0, 1.0) ** 2
    yoke = (
        sstep(yoke_lower - blend, yoke_lower + blend, z)
        * sstep(1.452 + blend, 1.452 - blend, z)
        * sstep(0.186, 0.172, ax)
        * sstep(0.020, 0.004, y)
    )

    shoulder_edge = 1.322 - (ax - 0.120) * 0.60
    shoulder = (
        sstep(shoulder_edge - blend, shoulder_edge + blend, z)
        * sstep(0.112, 0.126, ax)
        * sstep(0.240, 0.226, ax)
    )

    # Knee guard: a shield centred on the FRONT of the joint, falling off
    # around the leg. The first version was a z-band cut only by `y < 0.045`,
    # which wrapped the whole limb and read as two red strips down the sides of
    # the calf rather than as a knee panel.
    knee_centre = np.sqrt(((z - 0.470) / 0.095) ** 2 + ((np.abs(x) - 0.104) / 0.085) ** 2)
    knee = sstep(1.0, 0.72, knee_centre) * sstep(0.030, -0.020, y)

    forearm = (
        sstep(0.905 - blend, 0.905 + blend, z)
        * sstep(1.058 + blend, 1.058 - blend, z)
        * sstep(0.198, 0.212, ax)
        * sstep(0.016, 0.000, y)
    )

    belt = sstep(0.028, 0.018, np.abs(z - (1.012 - y * 0.10))) * sstep(0.150, 0.134, ax)

    panel = np.clip(yoke + shoulder + knee + forearm, 0.0, 1.0)
    accent = np.clip(glove + boot + belt, 0.0, 1.0)
    return panel, accent


def build_texture_set(ob, size, *, primary, panel_colour, accent_colour,
                      web_scale=52.0, weave_scale=1750.0, web_strength=1.0):
    """Base colour, roughness and tangent-space normal for one mesh."""
    position, normal, coverage = rasterize_attributes(ob, size)
    if not coverage.any():
        raise meshops.MeshOperationError(f"{ob.name}: UV rasterisation covered no texels")

    # How big one texel is ON THE MODEL. Everything below that has a real size
    # in millimetres has to be checked against this, because a feature finer
    # than a couple of texels does not get smaller as intended — it aliases,
    # and the aliasing pattern is coarser and far more visible than the detail
    # it replaced. The hand close-up rendered as diagonal corduroy for exactly
    # this reason: a 3.6 mm weave sampled at 1.4 mm texels.
    texel_m = math.sqrt(sum(p.area for p in ob.data.polygons) / max(int(coverage.sum()), 1))

    panel_w, accent_w = zone_weights(position)
    # Texels no UV island covers carry position (0, 0, 0), which is a real
    # point on the zone curves — the boot band happens to claim it — so left
    # alone they read as a solid accent field behind every island. Nothing may
    # be derived from a texel that has no surface under it.
    covered = coverage.astype(np.float32)
    panel_w = panel_w * covered
    accent_w = accent_w * covered

    base = np.empty((size, size, 3), dtype=np.float32)
    base[:] = np.array(primary, dtype=np.float32)
    base = base * (1.0 - panel_w[..., None]) + np.array(panel_colour, dtype=np.float32) * panel_w[..., None]
    base = base * (1.0 - accent_w[..., None]) + np.array(accent_colour, dtype=np.float32) * accent_w[..., None]

    # --- web pattern ---------------------------------------------------------
    # Strands are a darkened, slightly smoother line pressed INTO the surface,
    # not black paint on top. A web drawn as pure colour reads as a decal; a web
    # that also moves the normal and the roughness reads as construction.
    edge = web_distance(position, scale=web_scale)
    # Strand width and cell size are bounded by TEXEL DENSITY, not taste. At
    # 4096 px over ~37% UV coverage on a ~3.5 m² garment a texel is ~0.7 mm, so
    # a feature narrower than ~3 texels aliases. The first values (26 scale,
    # 0.055 strand) gave 8 cm cells that read as cracked leather rather than a
    # web.
    # The threshold is in NORMALISED cell units, so the real strand width is
    # threshold / web_scale metres. Raising the cell density while holding the
    # threshold fixed therefore kept SHRINKING the strand: at scale 52 a 0.026
    # threshold is a 0.5 mm line, well under one texel, which is why the web
    # was invisible in every full-body frame no matter how much contrast it was
    # given. Converting to metres first is what makes the width mean something.
    strand_m = 0.0026                       # 2.6 mm — a real woven cord
    strand = sstep(strand_m * web_scale, strand_m * web_scale * 0.28, edge) * web_strength
    # 0.34 was too dark: at full-body distance a third of the base colour
    # removed along every cell edge reads as crazed leather, not as a net laid
    # into a textile. The strand still exists in the normal and roughness maps
    # below, which is where construction should live — colour is the weakest
    # and least physical channel to express it in.
    base *= (1.0 - 0.045 * strand[..., None])

    # `scale` is radians per metre, so the weave repeats every 2*pi/scale. Hold
    # that to at least five texels: below that the crossed sines beat against
    # the texel grid instead of resolving, and no amount of amplitude tuning
    # helps because the artefact is in the sampling, not the signal.
    safe_weave_scale = min(weave_scale, (2.0 * math.pi) / (5.0 * texel_m))
    weave = triplanar_weave(position, normal, scale=safe_weave_scale)

    # --- seams ---------------------------------------------------------------
    # A stitched seam wherever a panel boundary falls.
    #
    # This is the single detail that separates "a body painted two shades of
    # grey" from "cut and sewn panels": real apparel is assembled from flat
    # pieces, and the join is always visible as a line of thread with a slight
    # ridge either side of it. A seam is exactly the zone's own 50% line, so
    # taking a band around that weight puts it on every panel edge
    # automatically, for any zone shape — including ones added later.
    #
    # It is derived IN WORLD SPACE for a reason. The first version took
    # np.gradient of the zone masks, which is a difference between ADJACENT
    # TEXELS — and two texels that neighbour each other in the atlas are
    # usually metres apart on the body, because a UV island boundary lies
    # between them. So it drew a bright groove along the outline of every
    # island: the mask came out covered in a staircase of cracks following its
    # unwrap, on a head that has no panel boundary anywhere on it. The band
    # below cannot do that, because it never looks at a neighbouring texel.
    # It also fixes the aliasing: a gradient seam was one to two texels wide
    # regardless of resolution, where this one has a real width in millimetres.
    def _band(w, sharpness=2.5):
        """A ridge centred on a zone's 50% line, ~6 mm wide at blend = 6 mm."""
        return np.clip(1.0 - np.abs(w * 2.0 - 1.0), 0.0, 1.0) ** sharpness

    seam = np.clip(_band(panel_w) + _band(accent_w), 0.0, 1.0)
    base *= (1.0 - 0.55 * seam[..., None])

    # --- ripstop grid --------------------------------------------------------
    # A reinforcing thread every few millimetres, which is what actually makes
    # technical apparel read as technical: it is regular, fine, and visible as
    # relief rather than as pattern. Without it the surface only has the
    # irregular web and a uniform weave, and it reads as a wetsuit.
    ripstop_m = 0.0065                      # 6.5 mm grid — real ripstop pitch
    gx = np.abs(((position[..., 0] / ripstop_m) % 1.0) - 0.5)
    gz = np.abs(((position[..., 2] / ripstop_m) % 1.0) - 0.5)
    ripstop = np.maximum(sstep(0.10, 0.02, gx), sstep(0.10, 0.02, gz))
    base *= (1.0 - 0.035 * ripstop[..., None])

    # --- roughness -----------------------------------------------------------
    rough = np.full((size, size), 0.66, dtype=np.float32)
    rough = rough * (1.0 - panel_w) + 0.58 * panel_w
    rough = rough * (1.0 - accent_w) + 0.47 * accent_w
    rough += weave * 0.075                      # highlight breakup along the threads
    rough -= ripstop * 0.05                      # the reinforcing thread is denser and glossier
    rough -= seam * 0.14                         # stitched thread is compressed and glossier
    rough -= strand * 0.040                      # strands sit denser, so a touch glossier
    rough = np.clip(rough, 0.05, 0.98)

    # --- height → tangent-space normal --------------------------------------
    # Differentiating in UV space IS the tangent basis, so no explicit tangents
    # are needed and the result is correct for any unwrap.
    # The strand is RAISED, not cut. A groove reads as a crack in the surface;
    # a ridge reads as a net laid into the weave, which is what it is.
    # Weave amplitude cut from 0.16. Even resolved, a thread is a few hundred
    # microns of relief; at 0.16 the finite difference tilted the normal by
    # more than twenty degrees per texel and the garment read as ribbed
    # corduroy over the whole body. Thread-scale detail belongs mostly in
    # roughness, which degrades gracefully when it cannot be resolved, rather
    # than in the normal map, which does not. The ripstop grid at 6.5 mm is
    # comfortably above texel size and is what now carries visible relief.
    # Strand relief cut from 0.34. At that height the cell edges rendered as a
    # network of deep cracks over the whole garment — the shin close-up read as
    # snakeskin, not as a net laid into a textile, and no colour tuning helps
    # because the artefact is in the normal map. Cells are 10-15 mm across, so
    # anything but a whisper of relief on their edges reads as reptile scale.
    # The ripstop grid is the motif that carries "technical" here; the web is
    # meant to be noticed second, on inspection.
    height = weave * 0.05 + strand * 0.09 + ripstop * 0.22 + seam * 0.85
    dy, dx = np.gradient(height.astype(np.float32))
    # Gradient strength was 2.2 and turned the weave into chunky square beads:
    # the finite difference is per-texel, so a strong multiplier amplifies texel
    # noise as much as it does real relief.
    nx = -dx * 1.1
    ny = -dy * 1.1
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal_map = np.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_map = normal_map * 0.5 + 0.5

    base = dilate(np.clip(base, 0.0, 1.0), coverage)
    rough_rgb = dilate(np.repeat(rough[..., None], 3, axis=-1), coverage)
    normal_map = dilate(normal_map, coverage)

    return {
        "base_color": base,
        "roughness": rough_rgb,
        "normal": normal_map,
        "coverage": float(coverage.mean()),
        # Reported so the build log says what detail this texture can actually
        # hold, instead of leaving it to be discovered in a render.
        "texel_mm": texel_m * 1000.0,
        "weave_mm": (2.0 * math.pi / safe_weave_scale) * 1000.0,
    }


# --- Blender plumbing --------------------------------------------------------

def _write_png(path, array, *, srgb=False):
    """Writes an 8-bit RGB PNG from a float array in [0, 1].

    Hand-rolled because the route through Blender is the problem being solved.
    A `float_buffer=True` image is required to get pixels IN (see the history in
    image_from_array), but glTF then exports it as a 16-bit PNG: the first
    textured export was 75 MB, which fails the byte budget at every delivery
    tier and is unusable in a browser. Quantising to 8 bits and compressing here
    produces a file an order of magnitude smaller with no visible difference on
    a colour, roughness or normal map.
    """
    import struct
    import zlib

    height, width = array.shape[:2]
    values = np.clip(array, 0.0, 1.0)

    if srgb:
        # The design is authored in LINEAR light, but a PNG tagged sRGB is
        # DECODED sRGB->linear when Blender loads it. Writing linear values into
        # an sRGB file therefore darkens everything twice over: a 0.215 red came
        # back as ~0.04 and the whole suit rendered muddy. Encoding here means
        # the decode on load returns exactly the values that were authored.
        # Roughness and normal are Non-Color and must NOT take this path.
        low = values * 12.92
        high = 1.055 * np.power(values, 1.0 / 2.4) - 0.055
        values = np.where(values <= 0.0031308, low, high)

    data = (values * 255.0 + 0.5).astype(np.uint8)

    # PNG scanlines are top-down and each is prefixed with a filter byte. The
    # arrays here are bottom-up (v=0 at row 0), matching the UV convention, so
    # they are flipped exactly once, here, at the boundary.
    rows = np.flipud(data)
    raw = np.zeros((height, width * 3 + 1), dtype=np.uint8)
    raw[:, 1:] = rows.reshape(height, width * 3)

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolour
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", header))
        fh.write(chunk(b"IDAT", zlib.compress(raw.tobytes(), 6)))
        fh.write(chunk(b"IEND", b""))
    return path


def image_from_file(name, path, *, colorspace):
    """Loads a PNG written by _write_png as a normal 8-bit Blender image.

    Going through a file sidesteps the entire float-buffer/colorspace-ordering
    minefield: nothing is written through `image.pixels`, so nothing can be
    silently zeroed, and what the exporter embeds is byte-for-byte the file that
    was inspected on disk.
    """
    image = bpy.data.images.load(path)
    image.name = name
    image.colorspace_settings.name = colorspace
    image.pack()
    return image


def image_from_array(name, array, *, colorspace):
    """numpy → a real bpy.types.Image that glTF will embed."""
    size = array.shape[0]
    # float_buffer=True is REQUIRED, not a preference. On a byte-buffer image
    # `pixels.foreach_set` updates a staging array that reads back correctly via
    # foreach_get but never reaches the ImBuf that rendering and saving use — so
    # the map renders and exports as pure black while every readback says the
    # data is fine. Verified by saving the same gradient both ways: 602 bytes
    # with a float buffer, 350 (an empty image) without.
    image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=True)

    # ORDER MATTERS, and this specific order was arrived at by measurement.
    #
    # Assigning colorspace_settings.name ZEROES the pixel buffer — it triggers a
    # reload from a file source that does not exist for a generated image. Doing
    # it after the write silently discarded every map: readbacks immediately
    # after foreach_set showed correct data, and the very next read after the
    # colorspace assignment showed RGB=0, A=1. That is why the suit rendered as
    # a black body with grey shards for three consecutive builds.
    image.colorspace_settings.name = colorspace

    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., :3] = array
    # No flip. Blender's pixel buffer is row-major from the BOTTOM-left, and the
    # rasteriser above already indexes row 0 at v=0 — which is also the bottom.
    image.pixels.foreach_set(rgba.ravel())
    image.update()
    image.pack()
    return image


def apply_baked_material(ob, maps, name, texture_dir=None):
    """Replaces the object's materials with ONE material driven by baked maps.

    Collapsing the body's three per-face slots into a single textured material
    is deliberate, and it is also the physically honest description: a real
    stretch suit is one fabric with dyed panels and a woven pattern, not three
    different substances welded together. The differentiation the brief asks for
    now lives where PBR actually expresses it — in the base colour and roughness
    maps — and it is continuous instead of quantised to polygons.

    Genuinely different substances (lens, polymer, metal, cartridge, mask
    fabric) remain separate materials on their own objects.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    # Written to disk as 8-bit PNGs and loaded back, rather than pushed through
    # image.pixels — see _write_png for why (75 MB export, and a pixel path with
    # two separate silent-zeroing failure modes).
    out = texture_dir or tempfile.mkdtemp(prefix="vox-tex-")
    os.makedirs(out, exist_ok=True)
    base_img = image_from_file(
        f"{name}_basecolor",
        _write_png(os.path.join(out, f"{name}_basecolor.png"), maps["base_color"], srgb=True),
        colorspace="sRGB")
    rough_img = image_from_file(
        f"{name}_roughness",
        _write_png(os.path.join(out, f"{name}_roughness.png"), maps["roughness"]),
        colorspace="Non-Color")
    normal_img = image_from_file(
        f"{name}_normal",
        _write_png(os.path.join(out, f"{name}_normal.png"), maps["normal"]),
        colorspace="Non-Color")

    tex_base = nt.nodes.new("ShaderNodeTexImage")
    tex_base.image = base_img
    tex_rough = nt.nodes.new("ShaderNodeTexImage")
    tex_rough.image = rough_img
    tex_normal = nt.nodes.new("ShaderNodeTexImage")
    tex_normal.image = normal_img

    normal_node = nt.nodes.new("ShaderNodeNormalMap")
    normal_node.inputs["Strength"].default_value = 1.0

    nt.links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(tex_normal.outputs["Color"], normal_node.inputs["Color"])
    nt.links.new(normal_node.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.44
    if "Sheen Weight" in bsdf.inputs:
        # Sheen is what separates cloth from plastic at grazing angles. Kept low:
        # at 0.32 it lifted the whole surface and the deep navy rendered mid-grey.
        bsdf.inputs["Sheen Weight"].default_value = 0.16
        bsdf.inputs["Sheen Roughness"].default_value = 0.32

    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for poly in ob.data.polygons:
        poly.material_index = 0
    ob.data.update()
    return mat, [base_img, rough_img, normal_img]
