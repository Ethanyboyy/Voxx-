import type { Confidence } from "@/generated/prisma/enums";

export interface ResearchResultItem {
  title: string;
  url: string | null;
  summary: string;
  retrievedAt: Date;
  /** 0 (irrelevant) – 1 (highly relevant) relevance to the query. */
  relevance: number;
  confidence: Confidence;
}

/**
 * Provider-agnostic research abstraction. Real providers (web search APIs,
 * document stores, etc.) plug in here without touching callers — see
 * CLAUDE.md. Phase 1 ships only the mock provider.
 */
export interface ResearchProvider {
  readonly id: string;
  search(query: string): Promise<ResearchResultItem[]>;
}
