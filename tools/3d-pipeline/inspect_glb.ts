/**
 * Reports what is actually inside a .glb, so an imported asset is integrated
 * from measurement rather than from assumption.
 *
 * The questions it answers are the ones that decide how an asset is wired up:
 * how many meshes there are, how heavy it is, where its origin and bounds sit,
 * what units it thinks it is in, and — most importantly for an anatomical
 * model — whether its structures are individually named and therefore
 * individually addressable. If they are, those names go straight into
 * asset.json's `components[].meshNames` and per-structure selection works with
 * no component changes.
 *
 *   npx tsx tools/3d-pipeline/inspect_glb.ts <path-to.glb> [--nodes 200]
 */
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: inspect_glb.ts <path-to.glb> [--nodes N]");
  process.exit(1);
}
const nodeLimitArg = process.argv.indexOf("--nodes");
const nodeLimit = nodeLimitArg > -1 ? Number(process.argv[nodeLimitArg + 1]) : 120;

const bytes = statSync(file).size;
const buffer = readFileSync(file);
// Copy into a standalone ArrayBuffer: a Node Buffer is a view into a shared
// pool, so handing its .buffer to the parser can expose unrelated memory.
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

new GLTFLoader().parse(arrayBuffer, "", (gltf) => {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const textures = new Set<string>();
  const named: string[] = [];

  gltf.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    named.push(mesh.name || "(unnamed)");
    const pos = mesh.geometry.getAttribute("position");
    if (pos) vertices += pos.count;
    const idx = mesh.geometry.getIndex();
    triangles += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      materials.add(`${m.type}:${m.name || "(unnamed)"}`);
      for (const [key, value] of Object.entries(m)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(`${key} ${(value as THREE.Texture).image?.width ?? "?"}x${(value as THREE.Texture).image?.height ?? "?"}`);
      }
    }
  });

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  const f = (n: number) => n.toFixed(4);
  console.log(`file            ${file}`);
  console.log(`bytes           ${bytes.toLocaleString()} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`meshes          ${meshes}`);
  console.log(`vertices        ${vertices.toLocaleString()}`);
  console.log(`triangles       ${Math.round(triangles).toLocaleString()}`);
  console.log(`materials       ${materials.size}`);
  for (const m of materials) console.log(`  - ${m}`);
  console.log(`textures        ${textures.size}`);
  for (const t of textures) console.log(`  - ${t}`);
  console.log(`bbox size       ${f(size.x)} x ${f(size.y)} x ${f(size.z)}`);
  console.log(`bbox centre     ${f(centre.x)}, ${f(centre.y)}, ${f(centre.z)}`);
  console.log(`longest axis    ${f(Math.max(size.x, size.y, size.z))}`);
  console.log(`animations      ${gltf.animations.map((a) => a.name).join(", ") || "(none)"}`);

  // The decisive question for anatomical interaction.
  const distinct = new Set(named.filter((n) => n !== "(unnamed)"));
  console.log(`\nindividually named meshes: ${distinct.size} of ${meshes}`);
  console.log(distinct.size > 1
    ? "  -> structures ARE individually addressable; map these into asset.json components[].meshNames"
    : "  -> structures are NOT individually addressable; per-structure selection is not possible from this file");
  console.log(`\nnode names (first ${nodeLimit}):`);
  for (const n of [...distinct].slice(0, nodeLimit)) console.log(`  ${n}`);
  if (distinct.size > nodeLimit) console.log(`  … ${distinct.size - nodeLimit} more`);
}, (err) => {
  console.error("failed to parse:", err);
  process.exit(1);
});
