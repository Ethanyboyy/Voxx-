# Canonical body assets

Real, rigged human GLB assets used as the shared body every GLB-backed suit
in the Suit Bay stands on (via `LabSuit.modelUrl` → `GltfSuitModel.tsx`,
which normalizes any of these to `CANONICAL_BODY_HEIGHT`/`CANONICAL_FEET_Y`
and applies the suit's real material). No file here is fabricated.

## xbot.glb — the current flagship body

- Source: `mrdoob/three.js`, `examples/models/gltf/Xbot.glb`
  (https://github.com/mrdoob/three.js)
- License: MIT (the three.js repository's own LICENSE; no separate license
  file exists for the `examples/models` directory, so the repo-level MIT
  terms apply). Originally sourced from Adobe Mixamo (a free rigging/
  animation service); this specific character ("Y Bot"/"X Bot") has been
  bundled in the three.js repo's public examples for over a decade and is
  one of the most widely used reference humanoid characters in the WebGL
  ecosystem.
- Real specs (read directly from the file, not estimated): 2 meshes,
  2 materials, ~49,100 triangles, 1 skin with 67 joints, 7 animation clips
  (unused here — see GltfSuitModel.tsx's SKINNED_UNRELIABLE note on why
  every SkinnedMesh in this pipeline is swapped for a plain rest-pose Mesh).
- Chosen over cesium-man.glb (below) after a direct visual comparison: this
  file has ~15x cesium-man.glb's triangle count and visibly correct human
  volume/proportions (shoulders, ribcage/waist taper, hip structure, elbow
  and knee definition, hands with separated fingers, feet with toes) in
  Raw Geometry debug mode — cesium-man.glb, by contrast, reads as a bare,
  low-detail placeholder body once the same test is applied.

## cesium-man.glb — retained, no longer the default

- Source: Khronos Group `glTF-Sample-Assets`, `Models/CesiumMan`
  (https://github.com/KhronosGroup/glTF-Sample-Assets)
- License: CC-BY 4.0, © 2017 Cesium (attribution required — see the
  sample-assets repo's own LICENSE.md for the full CesiumMan entry)
- Still supported by `GltfSuitModel.tsx`'s normalization (its "Z_UP"-named
  root needs a corrective rotation that `xbot.glb` and other standard
  Y-up glTF assets don't) but no longer used as any suit's default body:
  its real vertex/triangle count is far lower and its anatomy reads as
  noticeably less detailed once compared directly against xbot.glb under
  the same neutral-material test.
