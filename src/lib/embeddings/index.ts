import { LocalEmbeddingProvider } from "@/lib/embeddings/local";
import { VoyageEmbeddingProvider } from "@/lib/embeddings/voyage";
import type { EmbeddingProvider } from "@/lib/embeddings/types";

export type { EmbeddingProvider } from "@/lib/embeddings/types";
export { cosineSimilarity } from "@/lib/embeddings/similarity";

let cached: EmbeddingProvider | null = null;

/**
 * Resolves the active embedding provider. Local (zero-network, no third
 * party ever sees memory content) unless VOYAGE_API_KEY is explicitly set —
 * see PHASE_2_ARCHITECTURE.md §1 and SECURITY.md for why remote embedding is
 * opt-in only, never the default.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;

  const voyageKey = process.env.VOYAGE_API_KEY;
  cached = voyageKey ? new VoyageEmbeddingProvider(voyageKey) : new LocalEmbeddingProvider();
  return cached;
}

export function _resetEmbeddingProviderCache(): void {
  cached = null;
}
