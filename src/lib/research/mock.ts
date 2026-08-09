import type { ResearchProvider, ResearchResultItem } from "@/lib/research/types";

/**
 * Zero-network research provider. Phase 1 does not ship a live web-search
 * integration, so this returns a single transparent placeholder rather than
 * ever inventing search results — VOX must not present unverified claims as
 * facts. Wire a real provider behind the same ResearchProvider interface
 * when one is available (see .env.example VOX_RESEARCH_PROVIDER).
 */
export class MockResearchProvider implements ResearchProvider {
  readonly id = "mock";

  async search(query: string): Promise<ResearchResultItem[]> {
    const item: ResearchResultItem = {
      title: "No live research provider configured",
      url: null,
      summary: `VOX has no external research provider configured, so this query ("${query.slice(
        0,
        120
      )}") was not actually researched. Configure a real provider behind ResearchProvider and set VOX_RESEARCH_PROVIDER to enable live research.`,
      retrievedAt: new Date(),
      relevance: 0,
      confidence: "LOW",
    };
    return [item];
  }
}
