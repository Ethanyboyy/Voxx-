import { createNoise3D, type NoiseFunction3D } from "simplex-noise";

// Deterministic PRNG (mulberry32) so the procedural brain's geometry is
// reproducible across renders/tests rather than reseeding from Math.random()
// on every module load — the fold pattern should be stable, not different
// on every page refresh.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cachedNoise3D: NoiseFunction3D | null = null;
function getNoise3D(): NoiseFunction3D {
  if (!cachedNoise3D) cachedNoise3D = createNoise3D(mulberry32(1337));
  return cachedNoise3D;
}

/**
 * Ridged multifractal noise — the standard technique for organic
 * terrain/fold-like surface detail (used here for cortical gyri/sulci
 * instead of smooth Perlin bumps, which read as blobby rather than folded).
 * Each octave takes abs(noise), inverts it so ridges are sharp peaks, and
 * accumulates at increasing frequency/decreasing amplitude.
 */
export function ridgedNoise3D(x: number, y: number, z: number, octaves = 4, lacunarity = 2.05, gain = 0.55): number {
  const noise3D = getNoise3D();
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let normalization = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise3D(x * frequency, y * frequency, z * frequency);
    const ridged = 1 - Math.abs(n);
    sum += ridged * ridged * amplitude;
    normalization += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return normalization > 0 ? sum / normalization : 0;
}

/** Plain (non-ridged) noise for gentler, non-fold variation (e.g. cerebellar surface, subtle color variance). */
export function plainNoise3D(x: number, y: number, z: number): number {
  return getNoise3D()(x, y, z);
}
