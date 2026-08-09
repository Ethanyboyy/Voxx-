import { MockResearchProvider } from "@/lib/research/mock";
import { AnthropicWebSearchProvider } from "@/lib/research/anthropic";
import type { ResearchProvider } from "@/lib/research/types";

export type { ResearchProvider, ResearchResultItem } from "@/lib/research/types";

let cached: ResearchProvider | null = null;

/**
 * Resolves the active research provider. "mock" (default, and always used
 * in tests) never makes a network call. Set VOX_RESEARCH_PROVIDER=anthropic
 * with ANTHROPIC_API_KEY configured to use real web search — see
 * PHASE_2_ARCHITECTURE.md §2.
 */
export function getResearchProvider(): ResearchProvider {
  if (cached) return cached;

  const requested = process.env.VOX_RESEARCH_PROVIDER;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  cached =
    requested === "anthropic" && apiKey
      ? new AnthropicWebSearchProvider(apiKey)
      : new MockResearchProvider();
  return cached;
}

export function _resetResearchProviderCache(): void {
  cached = null;
}
