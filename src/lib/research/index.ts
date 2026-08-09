import { MockResearchProvider } from "@/lib/research/mock";
import type { ResearchProvider } from "@/lib/research/types";

export type { ResearchProvider, ResearchResultItem } from "@/lib/research/types";

let cached: ResearchProvider | null = null;

export function getResearchProvider(): ResearchProvider {
  if (cached) return cached;
  // Only "mock" is implemented in Phase 1; any other value still falls back
  // to mock rather than silently no-op, keeping behavior predictable.
  cached = new MockResearchProvider();
  return cached;
}

export function _resetResearchProviderCache(): void {
  cached = null;
}
