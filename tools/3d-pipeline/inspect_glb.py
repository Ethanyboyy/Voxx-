"""Reads a .glb and reports what it actually contains.

Deliberately parses the binary container directly rather than asking Blender,
because the question this answers is "what did the EXPORTER produce" — and the
one bug class that matters here is a scene that looks right in Cycles and
arrives in the browser missing its textures. Asking the tool that wrote the file
whether the file is correct is not a check.

    python tools/3d-pipeline/inspect_glb.py public/models/suits/<id>/suit.glb
"""

import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()

    magic, version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise SystemExit(f"{path} is not a GLB (bad magic)")
    if version != 2:
        raise SystemExit(f"{path} is glTF version {version}, expected 2")

    offset = 12
    gltf = None
    binary_len = 0
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:      # JSON
            gltf = json.loads(payload.decode("utf-8"))
        elif chunk_type == 0x004E4942:    # BIN
            binary_len = chunk_len
        offset += 8 + chunk_len + (-chunk_len % 4)

    if gltf is None:
        raise SystemExit(f"{path} has no JSON chunk")
    return gltf, binary_len, len(data)


def main():
    path = sys.argv[1]
    gltf, binary_len, total = read_glb(path)

    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    images = gltf.get("images", [])
    textures = gltf.get("textures", [])

    print(f"file            {path}")
    print(f"size            {total} bytes (binary chunk {binary_len})")
    print(f"meshes          {len(meshes)}")
    print(f"materials       {len(materials)}")
    print(f"textures        {len(textures)}")
    print(f"images          {len(images)}")

    # Every image must live in the binary chunk. An image with a `uri` pointing
    # at a file on disk is the failure this check exists for: it loads in
    # Blender and 404s in the browser.
    external = [im for im in images if "uri" in im and not im["uri"].startswith("data:")]
    embedded = [im for im in images if "bufferView" in im]
    print(f"embedded images {len(embedded)}/{len(images)}")
    if external:
        print(f"EXTERNAL IMAGE REFERENCES: {[im['uri'] for im in external]}")

    # Which PBR channels are actually wired up.
    channels = {"baseColorTexture": 0, "metallicRoughnessTexture": 0, "normalTexture": 0}
    for mat in materials:
        pbr = mat.get("pbrMetallicRoughness", {})
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            if key in pbr:
                channels[key] += 1
        if "normalTexture" in mat:
            channels["normalTexture"] += 1
    for key, count in channels.items():
        print(f"  {key:26s} on {count} material(s)")

    # UVs are what make any of those textures addressable.
    with_uv = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            if "TEXCOORD_0" in prim.get("attributes", {}):
                with_uv += 1
                break
    print(f"meshes with TEXCOORD_0  {with_uv}/{len(meshes)}")

    names = [m.get("name", "?") for m in meshes]
    print(f"mesh names      {names}")

    ok = (
        len(meshes) > 0
        and len(images) > 0
        and not external
        and len(embedded) == len(images)
        and with_uv == len(meshes)
        and channels["baseColorTexture"] > 0
        and channels["normalTexture"] > 0
    )
    print("VERDICT         " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
