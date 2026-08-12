import { describe, it, expect } from "vitest";
import { LocalEmbeddingProvider } from "@/lib/embeddings/local";
import { cosineSimilarity } from "@/lib/embeddings/similarity";

describe("LocalEmbeddingProvider", () => {
  const provider = new LocalEmbeddingProvider();

  it("has a fixed, documented dimensionality", () => {
    expect(provider.dimensions).toBe(256);
  });

  it("is deterministic — same text always produces the same vector", async () => {
    const a = await provider.embed("Ethan owns a small online shop");
    const b = await provider.embed("Ethan owns a small online shop");
    expect(a).toEqual(b);
  });

  it("produces an L2-normalized vector for non-empty text", async () => {
    const vector = await provider.embed("some reasonably long piece of text about retail inventory");
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("returns a zero vector for text with no meaningful tokens", async () => {
    const vector = await provider.embed("a an the");
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  it("ranks a topically similar sentence above an unrelated one", async () => {
    const query = await provider.embed("online shop revenue growth");
    const related = await provider.embed("The online shop had a strong month for revenue");
    const unrelated = await provider.embed("I want to try a new pasta recipe this weekend");

    const simRelated = cosineSimilarity(query, related);
    const simUnrelated = cosineSimilarity(query, unrelated);
    expect(simRelated).toBeGreaterThan(simUnrelated);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is 0 (not NaN) when either vector has zero magnitude", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });
});
