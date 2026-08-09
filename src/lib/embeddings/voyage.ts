import { VoyageAIClient } from "voyageai";
import { logger } from "@/lib/observability/logger";
import type { EmbeddingProvider } from "@/lib/embeddings/types";

const DEFAULT_MODEL = process.env.VOX_VOYAGE_MODEL ?? "voyage-4-nano";
const DEFAULT_DIMENSIONS = 512;

/**
 * Real neural embeddings via Voyage AI (Anthropic's recommended embedding
 * partner). Strictly opt-in: only used when VOYAGE_API_KEY is set (see
 * src/lib/embeddings/index.ts). Sends memory content to a third party —
 * see SECURITY.md before enabling.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = `voyage:${DEFAULT_MODEL}`;
  readonly dimensions = DEFAULT_DIMENSIONS;
  private readonly client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.embed({
        input: text,
        model: DEFAULT_MODEL,
        outputDimension: this.dimensions,
      });
      const vector = response.data?.[0]?.embedding;
      if (!vector) {
        throw new Error("Voyage embed response contained no embedding.");
      }
      return vector;
    } catch (error) {
      logger.error("embeddings.voyage.failed", {
        model: DEFAULT_MODEL,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
