"""Bundle writing and mesh measurement for the VOX suit asset contract.

Mirrors src/lib/generation/assetContract.ts. The TypeScript side is the gate
that decides whether a bundle may ship; this side is what produces one. The two
must agree on the shape of manifest.json and metadata.json, and
tests/asset-contract.test.ts pins that agreement by validating a bundle this
module actually wrote.

Every statistic here is MEASURED from the built scene. Nothing is estimated,
and a value that cannot be measured is omitted rather than filled in.
"""

import hashlib
import json
import os
import time

CONTRACT_VERSION = 1


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def measure_texture_stats(bpy, objects):
    """UV coverage and the baked images actually reachable from the materials.

    Walked from the MATERIALS rather than from bpy.data.images, so an image that
    exists but is not wired into anything cannot be reported as shipped.
    """
    uv_meshes = 0
    textures = {}
    for ob in objects:
        if ob.type != "MESH":
            continue
        if ob.data.uv_layers:
            uv_meshes += 1
        for slot in ob.material_slots:
            mat = slot.material
            if not mat or not mat.node_tree:
                continue
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image is not None:
                    textures[node.image.name] = int(node.image.size[0])
    return {
        "uvMeshes": uv_meshes,
        "textures": [{"name": n, "size": s} for n, s in sorted(textures.items())],
    }


def measure_scene(bpy, objects):
    """Real triangle/vertex/bounds/skin statistics for the given mesh objects.

    Triangles are counted from an evaluated, triangulated copy so modifiers
    (subsurf especially) are included — counting the base mesh would understate
    the shipped asset by an order of magnitude, which is exactly the kind of
    number that makes a budget check meaningless.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    verts = 0
    materials = set()
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    skinned = False
    joints = 0
    skin_complete = True
    bone_names = []

    for ob in objects:
        if ob.type != "MESH":
            continue
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        try:
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            verts += len(me.vertices)
            for slot in ob.material_slots:
                if slot.material:
                    materials.add(slot.material.name)
            for corner in ob.bound_box:
                world = ob.matrix_world @ __import__("mathutils").Vector(corner)
                for i in range(3):
                    lo[i] = min(lo[i], world[i])
                    hi[i] = max(hi[i], world[i])
        finally:
            ev.to_mesh_clear()

        arm = ob.find_armature()
        if arm is not None:
            skinned = True
            bone_names = [b.name for b in arm.data.bones]
            joints = len(bone_names)
            # A vertex with no group assignment has no skin weight, which is
            # the condition applyBoneTransform silently mis-handles at runtime.
            if any(len(v.groups) == 0 for v in ob.data.vertices):
                skin_complete = False

    if lo[0] == float("inf"):
        lo = hi = [0.0, 0.0, 0.0]

    # Blender is Z-up; the contract reports Y-up metres, matching the exported
    # glTF (the exporter converts Z-up → Y-up).
    size_x, size_y, size_z = (hi[i] - lo[i] for i in range(3))

    stats = {
        "triangles": tris,
        "vertices": verts,
        "meshes": sum(1 for o in objects if o.type == "MESH"),
        "materials": len(materials),
        "heightM": round(size_z, 6),
        "widthM": round(size_x, 6),
        "depthM": round(size_y, 6),
        "skinned": skinned,
        "joints": joints,
        "skinAttributesComplete": skin_complete if skinned else True,
    }
    if bone_names:
        stats["boneNames"] = bone_names
    stats.update(measure_texture_stats(bpy, objects))
    return stats


def write_bundle(out_dir, suit_id, provider, recipe, parameters, provenance, stats, build_ms, facing_axis="+Z"):
    """Writes metadata.json then manifest.json, and returns both.

    manifest.json is written last and deliberately excludes itself: a manifest
    cannot contain its own checksum, and pretending otherwise produces a file
    that never validates.
    """
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    metadata = {
        "contractVersion": CONTRACT_VERSION,
        "suitId": suit_id,
        "provider": provider,
        "recipe": recipe,
        "parameters": parameters,
        "provenance": provenance,
        "upAxis": "Y",
        "facingAxis": facing_axis,
        "stats": stats,
        "generatedAt": now,
        "buildMs": build_ms,
    }
    with open(os.path.join(out_dir, "metadata.json"), "w") as fh:
        json.dump(metadata, fh, indent=2)

    files = []
    for root, _dirs, names in os.walk(out_dir):
        for name in sorted(names):
            if name == "manifest.json":
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, out_dir).replace(os.sep, "/")
            files.append({"path": rel, "bytes": os.path.getsize(full), "sha256": _sha256(full)})

    manifest = {
        "contractVersion": CONTRACT_VERSION,
        "suitId": suit_id,
        "generatedAt": now,
        "files": files,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    return manifest, metadata
