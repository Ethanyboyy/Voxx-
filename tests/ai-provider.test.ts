import { describe, it, expect, afterEach } from "vitest";
import { getAIProvider, _resetAIProviderCache } from "@/lib/ai";
import { MockAIProvider } from "@/lib/ai/mock";
import { estimateCostUsd } from "@/lib/ai/cost";

describe("AI provider abstraction", () => {
  afterEach(() => {
    _resetAIProviderCache();
    delete process.env.VOX_COST_PER_1K_INPUT_TOKENS;
    delete process.env.VOX_COST_PER_1K_OUTPUT_TOKENS;
  });

  it("resolves the mock provider when VOX_AI_PROVIDER=mock (set for the whole test run)", () => {
    const provider = getAIProvider();
    expect(provider.id).toBe("mock");
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it("caches the resolved provider instance", () => {
    const first = getAIProvider();
    const second = getAIProvider();
    expect(first).toBe(second);
  });

  it("generate() echoes the last user message deterministically, with usage counts", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [{ role: "user", content: "hello VOX" }],
    });
    expect(result.content).toContain("hello VOX");
    expect(result.provider).toBe("mock");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("stream() yields text_delta events followed by a message_stop event", async () => {
    const provider = new MockAIProvider();
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "stream this" }] })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("message_stop");

    const joined = events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e.type === "text_delta" ? e.text : ""))
      .join("");
    expect(joined).toContain("stream this");
  });

  it("estimateCostUsd returns null without configured rates (never fabricates a price)", () => {
    expect(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });

  it("estimateCostUsd computes from explicit configured rates", () => {
    process.env.VOX_COST_PER_1K_INPUT_TOKENS = "3";
    process.env.VOX_COST_PER_1K_OUTPUT_TOKENS = "15";
    const cost = estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 });
    expect(cost).toBeCloseTo(18, 5);
  });
});
