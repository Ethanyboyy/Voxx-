/**
 * Provider-agnostic embedding abstraction — same shape as AIProvider and
 * ResearchProvider (see CLAUDE.md). Never call an embedding SDK/API outside
 * src/lib/embeddings/.
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
