import * as THREE from "three";

/**
 * Procedural technical-textile maps for the suit's base garment.
 *
 * The suit kept reading as "a body with armour bolted on" and the fix kept
 * being attempted geometrically — construction seams built as thin shells,
 * which floated off the mesh or vanished inside it depending on the millimetre.
 * That was the wrong tool. A garment reads as a garment because of how its
 * SURFACE responds to light: a woven face scatters, it has a weave direction,
 * and it never returns the clean single highlight bare skin does.
 *
 * This is now possible because the body asset carries real UVs (TEXCOORD_0 on
 * both of its meshes) — a fact an earlier comment in this pipeline asserted the
 * opposite of, without checking, which is why the material route went unused
 * for so long.
 *
 * Maps are generated once, cached by parameters, and tiled at high repeat, so
 * nothing here depends on knowing where any particular body region lands in the
 * UV layout.
 */

const TILE = 256;

export interface FabricMaps {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export type FabricKind = "TECHNICAL_WEAVE" | "RIBBED_ELASTOMER";

const cache = new Map<string, FabricMaps>();

/** Height field for one tile, in [0,1]. Sampled by the normal-map pass. */
function heightAt(kind: FabricKind, x: number, y: number): number {
  if (kind === "RIBBED_ELASTOMER") {
    // Directional ribbing: what a compression/elastomer zone actually looks
    // like, and visually distinct from the woven face at a glance.
    const rib = Math.sin(y * Math.PI * 2 * 12) * 0.5 + 0.5;
    const micro = Math.sin(x * Math.PI * 2 * 48) * 0.08;
    return rib * 0.85 + micro;
  }
  // Plain-weave twill: two interleaved thread systems, warp over weft. The
  // slight phase offset is what stops it reading as a checkerboard.
  const warp = Math.sin(x * Math.PI * 2 * 32);
  const weft = Math.sin(y * Math.PI * 2 * 32 + Math.PI / 3);
  const interlace = Math.sin((x + y) * Math.PI * 2 * 16) * 0.35;
  return (warp * weft * 0.5 + interlace * 0.5) * 0.5 + 0.5;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  return canvas;
}

/**
 * Sobel-converts the height field into a tangent-space normal map.
 *
 * Sampling wraps at the tile edges rather than clamping — clamping leaves a
 * visible seam every repeat, and at the repeat counts a garment needs that is
 * a grid of lines across the whole body.
 */
function buildNormalMap(kind: FabricKind, strength: number): THREE.Texture {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const image = ctx.createImageData(TILE, TILE);
  const wrap = (v: number) => (v + TILE) % TILE;
  const h = (px: number, py: number) => heightAt(kind, wrap(px) / TILE, wrap(py) / TILE);

  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      // Normalise (-dx, -dy, 1) into the 0..255 encoding a normal map uses.
      const len = Math.hypot(dx, dy, 1);
      const i = (y * TILE + x) * 4;
      image.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Roughness variation. A real textile is not uniformly matte: the thread
 * crowns catch light while the interstices stay dull, and that variance is
 * most of what separates cloth from a flat matte plastic under one key light.
 */
function buildRoughnessMap(kind: FabricKind, base: number, variance: number): THREE.Texture {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const image = ctx.createImageData(TILE, TILE);

  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const height = heightAt(kind, x / TILE, y / TILE);
      // Crowns (high) are smoother; valleys stay rough.
      const r = THREE.MathUtils.clamp(base - (height - 0.5) * variance, 0, 1);
      const v = r * 255;
      const i = (y * TILE + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Returns the map pair for a fabric kind, generating on first use.
 *
 * Cached process-wide: these depend only on their parameters, every suit that
 * uses the same textile shares them, and regenerating a 256² tile per suit
 * would be pure waste. They are deliberately never disposed — the cache is a
 * small fixed set that lives as long as the page.
 */
export function getFabricMaps(kind: FabricKind, repeat: number): FabricMaps {
  const key = `${kind}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const isElastomer = kind === "RIBBED_ELASTOMER";
  const normalMap = buildNormalMap(kind, isElastomer ? 22 : 14);
  const roughnessMap = buildRoughnessMap(kind, isElastomer ? 0.62 : 0.86, isElastomer ? 0.3 : 0.22);
  for (const map of [normalMap, roughnessMap]) {
    map.repeat.set(repeat, repeat);
  }

  const maps = { normalMap, roughnessMap };
  cache.set(key, maps);
  return maps;
}

/** True when texture generation can run — canvas is browser-only, and this
 *  module is imported by code that also runs during SSR. */
export function canBuildFabric(): boolean {
  return typeof document !== "undefined";
}
