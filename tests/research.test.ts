import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { runResearch, listResearchItems } from "@/lib/research/service";
import { getResearchProvider, _resetResearchProviderCache } from "@/lib/research";
import { AnthropicWebSearchProvider } from "@/lib/research/anthropic";
import { createTestUser } from "./helpers";

describe("research engine", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("mock provider never fabricates results and marks them low-confidence", async () => {
    const provider = getResearchProvider();
    const results = await provider.search("best online shop customer service tools");
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.confidence).toBe("LOW");
      expect(result.retrievedAt).toBeInstanceOf(Date);
    }
  });

  it("persists ResearchItem rows preserving source, title, relevance, confidence, retrieval time", async () => {
    const items = await runResearch(userId, "customer acquisition strategies for a small online shop");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.query).toBe("customer acquisition strategies for a small online shop");
      expect(item.provider).toBe("mock");
      expect(item.title).toBeTruthy();
      expect(item.confidence).toBeDefined();
      expect(item.retrievedAt).toBeInstanceOf(Date);
      expect(typeof item.relevance).toBe("number");
    }
  });

  it("listResearchItems returns items scoped to the user, most recent first", async () => {
    const otherUser = await createTestUser();
    await runResearch(otherUser.id, "unrelated query");
    await runResearch(userId, "second query");

    const items = await listResearchItems(userId);
    expect(items.every((i) => i.query !== "unrelated query")).toBe(true);
    expect(items[0].query).toBe("second query");
  });
});

describe("research provider factory", () => {
  afterEach(() => {
    _resetResearchProviderCache();
    delete process.env.VOX_RESEARCH_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("defaults to mock (the test-wide env setting)", () => {
    expect(getResearchProvider().id).toBe("mock");
  });

  it("stays on mock if VOX_RESEARCH_PROVIDER=anthropic is set without an API key", () => {
    process.env.VOX_RESEARCH_PROVIDER = "anthropic";
    expect(getResearchProvider().id).toBe("mock");
  });

  it("switches to the real Anthropic provider once both are set", () => {
    process.env.VOX_RESEARCH_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
    const provider = getResearchProvider();
    expect(provider).toBeInstanceOf(AnthropicWebSearchProvider);
    expect(provider.id).toBe("anthropic");
  });
});
