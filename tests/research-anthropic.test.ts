import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { parseWebSearchResponse } from "@/lib/research/anthropic";

const RETRIEVED_AT = new Date("2026-08-09T00:00:00Z");

function textBlock(text: string, citations: Anthropic.TextCitation[] | null = null): Anthropic.ContentBlock {
  return { type: "text", text, citations };
}

function webSearchResultBlock(
  results: Array<{ title: string; url: string; page_age?: string | null }>
): Anthropic.ContentBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: "toolu_123",
    caller: { type: "direct" },
    content: results.map((r) => ({
      type: "web_search_result",
      title: r.title,
      url: r.url,
      page_age: r.page_age ?? null,
      encrypted_content: "opaque",
    })),
  };
}

function citation(title: string, url: string, citedText: string): Anthropic.TextCitation {
  return {
    type: "web_search_result_location",
    title,
    url,
    cited_text: citedText,
    encrypted_index: "opaque",
  };
}

describe("parseWebSearchResponse", () => {
  it("turns a cited claim into a MEDIUM-confidence, source-attributed item", () => {
    const content: Anthropic.ContentBlock[] = [
      textBlock("Revenue grew 12% year over year.", [
        citation("Industry Report 2026", "https://example.com/report", "revenue grew 12% YoY"),
      ]),
    ];

    const items = parseWebSearchResponse(content, RETRIEVED_AT);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Industry Report 2026",
      url: "https://example.com/report",
      summary: "revenue grew 12% YoY",
      confidence: "MEDIUM",
    });
    expect(items[0].retrievedAt).toBe(RETRIEVED_AT);
  });

  it("keeps raw (uncited) search results as separate LOW-confidence items", () => {
    const content: Anthropic.ContentBlock[] = [
      webSearchResultBlock([{ title: "Some Page", url: "https://example.com/a", page_age: "2 days ago" }]),
      textBlock("I couldn't find a clear answer.", null),
    ];

    const items = parseWebSearchResponse(content, RETRIEVED_AT);
    const raw = items.find((i) => i.url === "https://example.com/a");
    expect(raw?.confidence).toBe("LOW");
    expect(raw?.summary).toContain("not directly cited");
  });

  it("does not duplicate a URL that is both a raw result and a citation — keeps the grounded version", () => {
    const content: Anthropic.ContentBlock[] = [
      textBlock("Cited claim.", [citation("Source", "https://example.com/x", "the cited text")]),
      webSearchResultBlock([{ title: "Source", url: "https://example.com/x" }]),
    ];

    const items = parseWebSearchResponse(content, RETRIEVED_AT);
    const matches = items.filter((i) => i.url === "https://example.com/x");
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe("MEDIUM");
    expect(matches[0].summary).toBe("the cited text");
  });

  it("separates the model's uncited reasoning into its own url:null, LOW-confidence item", () => {
    const content: Anthropic.ContentBlock[] = [
      textBlock("Cited fact.", [citation("Source", "https://example.com/y", "cited")]),
      textBlock("Based on the above, I'd guess this trend continues.", null),
    ];

    const items = parseWebSearchResponse(content, RETRIEVED_AT);
    const synthesis = items.find((i) => i.url === null);
    expect(synthesis).toBeDefined();
    expect(synthesis?.confidence).toBe("LOW");
    expect(synthesis?.summary).toContain("trend continues");
  });

  it("produces nothing but the synthesis item when there are no search results at all", () => {
    const content: Anthropic.ContentBlock[] = [textBlock("Just a plain, unsourced answer.", null)];
    const items = parseWebSearchResponse(content, RETRIEVED_AT);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBeNull();
  });

  it("ignores a web_search_tool_result that is an error, not a result array", () => {
    const content: Anthropic.ContentBlock[] = [
      {
        type: "web_search_tool_result",
        tool_use_id: "toolu_err",
        caller: { type: "direct" },
        content: { type: "web_search_tool_result_error", error_code: "unavailable" },
      },
    ];
    expect(() => parseWebSearchResponse(content, RETRIEVED_AT)).not.toThrow();
    expect(parseWebSearchResponse(content, RETRIEVED_AT)).toHaveLength(0);
  });
});
