import * as THREE from "three";

/**
 * Poses a rigged body ONCE on the CPU and bakes the result into static
 * geometry.
 *
 * Why this exists: every suit rendered in a T-pose, arms straight out, which
 * reads as a rigging asset rather than a finished object no matter how good
 * the armour on it is. The obvious fix — pose the skeleton and let the GPU
 * skin it — is closed off here: live skinning on these assets renders either
 * badly distorted or not at all (see SKINNING_UNRELIABLE in GltfSuitModel),
 * which is why the pipeline swaps SkinnedMesh for plain Mesh in the first
 * place.
 *
 * So the skinning math runs here instead, on the CPU, exactly once per asset.
 * `SkinnedMesh.applyBoneTransform` applies the same weighted bone transforms
 * the GPU would, via the inverse bind matrices — which is also what reconciles
 * this asset's two coordinate spaces (mesh authored at ~0.018 units, skeleton
 * at Mixamo centimetre scale). Baking sidesteps the broken GPU path entirely
 * and costs nothing at render time.
 */

/** A target direction for one bone, expressed in WORLD space. */
export interface BoneAim {
  /** Bone name, without the "mixamorig:" / "mixamorig_" prefix. */
  bone: string;
  /** The joint this bone points at, used to measure its current direction. */
  toBone: string;
  /** Desired world-space direction, from bone toward toBone. Normalised here. */
  aim: [number, number, number];
}

/**
 * A relaxed standing pose.
 *
 * Arms come down and slightly forward rather than dead vertical: dead-vertical
 * arms merge with the torso silhouette and the figure reads as a plank. The
 * small asymmetry between left and right is deliberate — a perfectly mirrored
 * figure reads as a mannequin, and this is the cheapest way to break that.
 */
export const PRESENTATION_POSE: BoneAim[] = [
  // Upper arm carries most of the clearance. The forearm must keep going
  // OUTWARD, not fold back in: the first version aimed the forearms inboard
  // and the hands met at the waist, which reads as a figure standing to
  // attention holding something — and it buried the forearm guards against
  // the hips where nothing could see them.
  // SIGN MATTERS, and it is not the sign you would guess from the bone names.
  // This asset faces +Z, so with Y up the character's LEFT is +X (left =
  // up × forward). Aiming "Left*" bones at −X swings both arms across the
  // chest, where they end up inside the torso — the render showed a figure
  // with no arms at all, which is what sent me looking.
  { bone: "LeftArm", toBone: "LeftForeArm", aim: [0.4, -0.9, 0.12] },
  { bone: "RightArm", toBone: "RightForeArm", aim: [-0.42, -0.89, 0.1] },
  { bone: "LeftForeArm", toBone: "LeftHand", aim: [0.34, -0.93, 0.13] },
  { bone: "RightForeArm", toBone: "RightHand", aim: [-0.36, -0.92, 0.14] },
  { bone: "LeftHand", toBone: "LeftHandMiddle1", aim: [0.3, -0.94, 0.16] },
  { bone: "RightHand", toBone: "RightHandMiddle1", aim: [-0.32, -0.93, 0.17] },
  // Legs need real separation. Aiming them near-vertical from hip sockets that
  // are already inboard made the thighs converge and interpenetrate at the
  // knees — a defect that reads instantly as broken.
  { bone: "LeftUpLeg", toBone: "LeftLeg", aim: [0.17, -0.985, 0] },
  { bone: "RightUpLeg", toBone: "RightLeg", aim: [-0.15, -0.989, 0] },
  { bone: "LeftLeg", toBone: "LeftFoot", aim: [0.06, -0.998, 0] },
  { bone: "RightLeg", toBone: "RightFoot", aim: [-0.05, -0.999, 0] },
];

/**
 * GLTFLoader sanitises node names, turning "mixamorig:Head" into
 * "mixamorig_Head". Matching only the colon form silently missed every bone
 * once and left the armour unmounted, so both separators are accepted.
 */
export function normalizeBoneName(name: string): string {
  const match = /^mixamorig[:_]?(.+)$/i.exec(name);
  return (match ? match[1] : name).replace(/^[:_]+/, "");
}

function indexBones(skeleton: THREE.Skeleton): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>();
  for (const bone of skeleton.bones) map.set(normalizeBoneName(bone.name), bone);
  return map;
}

/**
 * Rotates each named bone so it points along its target direction.
 *
 * Works in world space and converts back to the bone's local frame, rather
 * than setting local Euler angles directly. Mixamo bones do not share a
 * consistent local axis convention — the axis that swings an arm down is not
 * the same axis on every joint — so local-space rotations are guesswork,
 * whereas "point this bone that way" is unambiguous.
 */
function aimBones(skeleton: THREE.Skeleton, pose: BoneAim[]): void {
  const bones = indexBones(skeleton);

  for (const step of pose) {
    const bone = bones.get(step.bone);
    const child = bones.get(step.toBone);
    if (!bone || !child) continue;

    // Positions must be current: each bone we rotate moves its descendants,
    // so the next bone's measurement depends on this one having been applied.
    bone.updateWorldMatrix(true, true);

    const from = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    const to = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
    const current = to.sub(from);
    if (current.lengthSq() < 1e-12) continue;
    current.normalize();

    const target = new THREE.Vector3(...step.aim).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(current, target);

    const worldQuat = new THREE.Quaternion();
    bone.getWorldQuaternion(worldQuat);
    const desiredWorld = delta.multiply(worldQuat);

    // local = parentWorld⁻¹ · desiredWorld
    const parentWorld = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
    bone.updateWorldMatrix(false, true);
  }
}

/**
 * Returns a new static BufferGeometry holding the mesh's vertices in the
 * given pose, or null when the mesh carries no skinning data to apply.
 *
 * Normals are recomputed rather than transformed: a posed limb's normals are
 * genuinely different, and reusing the rest-pose normals leaves shading that
 * belongs to a different shape — which reads as flat, wrong-looking limbs.
 */
export interface BakedPose {
  geometry: THREE.BufferGeometry;
  /**
   * Every joint's posed position, in the MESH's local space — the same space
   * the baked vertices are in, so the caller can map both through one matrix.
   *
   * This is the anchor source the armour rig actually wants. The previous rig
   * inferred mount points from the body's bounding box, which works for a
   * T-pose (the box IS the arm span) and collapses to guesswork for anything
   * else: the first posed render put the forearm guards out in mid-air beside
   * the hips because the box no longer knew where the arms were.
   */
  joints: Map<string, THREE.Vector3>;
}

/**
 * Where a joint ends up once the pose is applied, in mesh-local space.
 *
 * Derivation: three skins a vertex as
 *   v' = bindMatrixInverse · boneMatrixWorld · boneInverse · bindMatrix · v
 * A joint is the origin of its own bone, so bindMatrix and boneInverse cancel
 * against the bone's own rest transform and the whole chain collapses to
 *   joint' = bindMatrixInverse · boneMatrixWorld · origin
 * which needs no per-vertex work and is exact rather than fitted.
 */
function jointPositions(mesh: THREE.SkinnedMesh): Map<string, THREE.Vector3> {
  const out = new Map<string, THREE.Vector3>();
  for (const bone of mesh.skeleton.bones) {
    const p = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(mesh.bindMatrixInverse);
    out.set(normalizeBoneName(bone.name), p);
  }
  return out;
}

export function bakePosedGeometry(mesh: THREE.SkinnedMesh, pose: BoneAim[] = PRESENTATION_POSE): BakedPose | null {
  const skeleton = mesh.skeleton;
  const position = mesh.geometry.getAttribute("position");
  // applyBoneTransform reads BOTH skinIndex and skinWeight. Guarding only the
  // first let a mesh through that had no skinWeight, and three then threw
  // "Cannot read properties of undefined (reading 'getX')" from inside
  // fromBufferAttribute — an error whose message names neither attribute.
  const hasSkinning = Boolean(mesh.geometry.getAttribute("skinIndex") && mesh.geometry.getAttribute("skinWeight"));
  if (!skeleton || !position || !hasSkinning) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "SUITDBG pose-bake skipped:",
        JSON.stringify({
          mesh: mesh.name,
          skeleton: Boolean(skeleton),
          attributes: Object.keys(mesh.geometry.attributes),
        })
      );
    }
    return null;
  }

  mesh.updateWorldMatrix(true, true);
  aimBones(skeleton, pose);
  skeleton.update();
  // applyBoneTransform reads bindMatrix/bindMatrixInverse off the mesh, so the
  // mesh's own matrices must be current too.
  mesh.updateMatrixWorld(true);

  const baked = mesh.geometry.clone();
  const out = baked.getAttribute("position") as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
    mesh.applyBoneTransform(i, vertex);
    out.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  out.needsUpdate = true;

  // The baked mesh is a plain Mesh; leaving skinning attributes on it wastes
  // GPU memory and invites a renderer path that expects a skeleton.
  baked.deleteAttribute("skinIndex");
  baked.deleteAttribute("skinWeight");
  baked.computeVertexNormals();
  baked.computeBoundingBox();
  baked.computeBoundingSphere();
  return { geometry: baked, joints: jointPositions(mesh) };
}
