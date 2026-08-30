# VOX master suit — status against the quality gate

**Verdict: HERO tier PASS on the automated gate; NON-PRODUCTION on visual
inspection. `modelUrl` is NOT assigned.**

Build: `tools/3d-pipeline/build_suit.py`. Renders in `renders/`.

| Measure | Value |
| --- | --- |
| Triangles | 72,700 (HERO budget 180k; over STANDARD 60k) |
| Vertices / meshes / materials | 36,678 / 14 / 6 |
| Textures | 2048 garment, 1024 mask — base colour, roughness, normal |
| Texture bytes | 8.5 MB (first textured export was 75 MB) |
| GLB | 10,912,568 bytes |
| Asset QA gate | **HERO PASS (17 checks)**; STANDARD and MOBILE fail on triangle + byte budget |
| glTF container check | **PASS** — 6/6 images embedded, 14/14 meshes with TEXCOORD_0 |
| Repo gate | 418 tests, typecheck clean, lint 0 errors, production build passes |

---

## 1. What this pass changed

The previous pass was rejected as "technically valid, visually a mannequin". Its
own assessment named one blocking limitation: garment zones were assigned per
FACE, so panel boundaries quantised to ~1 cm polygons, and Blender's procedural
weave does not survive glTF export. Both are now fixed by the stage that was
missing — **baked PBR textures**.

| Area | Before | Now |
| --- | --- | --- |
| Panel boundaries | per-face material index, stair-stepped | per-TEXEL analytic masks with smoothstep transitions |
| Web pattern | absent (the Garment gate failure) | 3D Voronoi net, ~1.9 cm cells, 2.6 mm strands, baked to colour + roughness + normal |
| Fabric | Blender procedural nodes — **lost on export** | baked triplanar weave, survives glTF |
| Head | "smooth ovoid" | brow, forehead, eye sockets, nose, cheekbones, jaw angle, chin, temple, occiput |
| Head mesh density | uniform with the body | head region locally refined (`meshops.refine_region`) |
| Body anatomy | 26 muscle fields | + clavicle, clavicle hollow, serratus, lat insertion, trapezius neck |
| Materials | 8, three of them per-face zones on one mesh | 6 real substances; garment differentiation moved into base-colour and roughness maps |
| Textures | none | 2048 px garment set, 1024 px mask set (base colour, roughness, normal), 8-bit PNG |

**Why the body collapsed from three materials to one, deliberately:** a real
stretch suit is one fabric with dyed panels, not three substances welded
together. Expressing the panels as texture is both the physically honest
description and the only way to get a boundary that is not polygon-shaped.
Genuinely different substances — lens, polymer, metal, cartridge, mask fabric —
remain separate materials.

## 2. Gate results

**Geometry — PARTIAL.** Continuous body, no booleans in the anatomy, head with
real facial structure, fitted mask, integrated lenses. Hands and feet are
defined and unmistakable but were NOT refined this pass — §11 and §12 of the
brief are outstanding.

**Head/mask/lenses — PASS.** The mask is built from the head's own surface at a
4.5 mm offset and 3.5 mm thickness, so every landmark telegraphs through it.
Lenses are shaped superellipse solids recessed into the mask by boolean.

**Garment — PASS.** Panel boundaries are smooth curves following anatomy; the
web pattern is present, continuous across UV islands, and legible at both hero
and close range; the weave holds up at close inspection without becoming noise.
The knee shields' falloff is wider than a cut panel would be — they read
slightly airbrushed at close range.

**Technology — PARTIAL.** Five named parts per arm, housing curved to the
forearm radius and flush-mounted, cartridge interfacing with the mechanism,
trigger palm-side, plus retention straps and fasteners added this pass. It still
reads as a slab-and-cylinder assembly rather than a compact engineered
mechanism, which is a named reject criterion — see §5.

**Rendering — PASS.** Diagnostic and cinematic rigs remain separate. All
required views render with the full figure contained.

**VOX compatibility — PASS.** Y-up, faces +Z, UVs on all 14 meshes, baked maps
embedded in the GLB, component ids match `drilldown.ts`.

## 3. Defects found this pass — each only by looking at a render

Typecheck, lint and the full suite were green through every one of these.

1. **Facial fields at 3× the workable strength** produced a grotesque: brow
   shelves, lumpy chin, bulging cheeks. Adjacent tight fields SUM where they
   overlap, and normal-direction displacement on an already-curved surface
   amplifies. Reverted to roughly a third the strength and twice the radius.
2. **`colorspace_settings.name` zeroes the pixel buffer.** Assigning it *after*
   writing pixels silently discarded every baked map — readbacks straight after
   `foreach_set` were correct, and the very next read after the colorspace
   assignment showed RGB=0, A=1. This rendered the suit black with grey shards
   for **three consecutive builds**. Colorspace must be set first.
3. **`float_buffer=False` images never reach the render/save buffer.** Pixels
   read back correctly via `foreach_get` and save as an empty image. Verified by
   writing the same gradient both ways: 602 bytes vs 350.
4. **Strand width was expressed in normalised Voronoi units.** Real width is
   `threshold / web_scale` metres, so every increase in cell density silently
   *shrank* the strand — at scale 52 the threshold was a 0.5 mm line, under one
   texel, and the web was invisible in every full-body frame regardless of
   contrast. Width is now specified in metres.
5. **Web cell size is bounded from both ends.** 2.3 cm read as crazed glaze
   close up; 1.4 cm went sub-pixel and vanished at hero distance. 1.9 cm
   survives both.
6. **Normal-map gradient strength of 2.2** amplified per-texel noise as much as
   real relief and turned the weave into chunky square beads.
7. **Collar notch** where the chest yoke stopped short of the neck.
8. **Reduced Voronoi jitter (0.28) made the web worse** — larger, sparser
   cells reading as cracks. Reverted to 0.70.

Guards added for the ones that can recur silently: `uv-on-every-mesh`,
`baked-maps-present`, `texture-resolution` in the asset contract, backed by
`tests/texture-contract.test.ts`.

## 4. Honest remaining weaknesses

- The web is a **Voronoi cell net**, not a radial-and-concentric spider web. It
  reads as an engineered technical net. That is a deliberate design choice for
  VOX and looks intentional, but it is not a literal spider-web and should not
  be described as one.
- Fingers still read slightly soft. They are unmistakably hands with separated
  digits and a thumb, but they are not refined.
- The figure is athletic rather than heroic-muscular. Peak muscle displacement
  is 24.7 mm.
- UV coverage on the garment is 36.6%. Smart UV Project leaves substantial empty
  texture space; a packed unwrap would buy roughly a factor of two in effective
  texel density at the same file size.
- The suit has no insignia or emblem.

## 5. modelUrl — withheld, deliberately

The automated gate passes at HERO. The visual bar does not, and the brief is
explicit that both are required.

Two items on the reject list are still true of this asset:

- **Primitive wrist hardware.** The web-shooter gained retention straps,
  fasteners, a gunmetal finish and an emitter aperture this pass, and it is
  mounted flush to the forearm radius rather than floating. It is still a
  slab-and-cylinder assembly rather than a compact engineered mechanism.
- **Sausage fingers.** Untouched this pass. §11 and §12 (finger taper, foot
  silhouette) were not attempted.

Assigning `modelUrl` now would mean widening the bar to fit the asset, which is
the opposite of what the gate is for. It stays withheld.

## 6. Bugs found this pass — none visible to the automated gate

Every one of these passed typecheck, lint and the full suite while producing a
visibly broken asset. They are recorded because the pattern is the point: the
render loop is not optional.

1. `image.colorspace_settings.name` **zeroes the pixel buffer**. Set after
   writing pixels it discarded every map; the suit rendered black with grey
   shards for three consecutive builds.
2. `float_buffer=False` images never reach the render/save buffer at all —
   readbacks succeed, saves are empty. 602 bytes vs 350 on the same gradient.
3. Voronoi strand width was in normalised cell units, so raising cell density
   silently shrank the strand to 0.5 mm — sub-texel, invisible at any contrast.
4. Facial fields at 3x workable strength produced a grotesque. Reverted.
5. Float buffers export as **16-bit PNG**: the first textured GLB was 75 MB and
   unusable. Replaced with a hand-rolled 8-bit PNG encoder.
6. Linear values written into an **sRGB-tagged PNG** are decoded again on load —
   a 0.215 red came back as 0.04 and the whole suit rendered muddy.
