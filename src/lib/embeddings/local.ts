import type { EmbeddingProvider } from "@/lib/embeddings/types";

const DIMENSIONS = 256;

// Small, deliberately conservative English stopword list — enough to keep the
// most common function words from dominating a corpus-free term-frequency
// vector, without pulling in a dictionary/NLP dependency.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to", "in",
  "on", "at", "for", "with", "about", "as", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "this", "that", "these", "those", "i", "you",
  "he", "she", "we", "they", "my", "your", "his", "her", "our", "their",
  "do", "does", "did", "not", "no", "yes", "have", "has", "had", "will",
  "would", "can", "could", "should", "may", "might", "must", "there", "here",
]);

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

// FNV-1a 32-bit — fast, deterministic, no dependency. Two independent seeds
// give an index hash and a sign hash (the standard "hashing trick" for
// feature hashing, which halves the expected bias from hash collisions).
function fnv1a(str: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Zero-network, zero-dependency, deterministic embedding: feature-hashed,
 * term-frequency-weighted, L2-normalized bag-of-words. This is
 * lexical/statistical similarity (shared words, ranked by frequency and
 * hashed into a fixed-size vector) — not a trained neural embedding, so it
 * won't catch pure synonym rewrites the way one would. It's VOX's default
 * because it requires no third-party API (memory content never leaves the
 * device) and no model download, and because the realistic neural
 * alternatives (Hugging Face Hub, Voyage AI, OpenAI) were all unreachable
 * from this project's dev sandbox when this was built — see
 * PHASE_2_ARCHITECTURE.md §1. VoyageEmbeddingProvider is the opt-in upgrade
 * to real neural embeddings.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hashed-256";
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
      const index = fnv1a(token, 0x811c9dc5) % DIMENSIONS;
      const sign = fnv1a(token, 0x9e3779b9) % 2 === 0 ? 1 : -1;
      vector[index] += sign;
    }

    let normSquared = 0;
    for (const value of vector) normSquared += value * value;
    if (normSquared === 0) return vector;

    const norm = Math.sqrt(normSquared);
    return vector.map((value) => value / norm);
  }
}
