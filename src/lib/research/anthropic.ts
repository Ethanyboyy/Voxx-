import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/observability/logger";
import type { ResearchProvider, ResearchResultItem } from "@/lib/research/types";

const DEFAULT_MODEL = process.env.VOX_ANTHROPIC_MODEL ?? "claude-sonnet-5";

/**
 * Turns a Messages API response (with the web_search tool enabled) into
 * ResearchResultItems. Pulled out as a pure function, independent of the
 * network call, so it's directly testable with a hand-built response —
 * see tests/research-anthropic.test.ts.
 *
 * Three passes, in order of evidentiary strength:
 * 1. Cited claims (TextBlock.citations) — sources the model actually used,
 *    with the exact grounded text. confidence MEDIUM.
 * 2. Raw search results the model saw but didn't cite. confidence LOW.
 * 3. The model's own uncited reasoning/synthesis — VOX's inference, not a
 *    retrieved fact, kept as its own clearly-labeled item. confidence LOW.
 */
export function parseWebSearchResponse(content: Anthropic.ContentBlock[], retrievedAt: Date): ResearchResultItem[] {
  const items: ResearchResultItem[] = [];
  const seenUrls = new Set<string>();
  let ungroundedText = "";

  for (const block of content) {
    if (block.type !== "text" || !block.citations?.length) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location") continue;
      if (seenUrls.has(citation.url)) continue;
      seenUrls.add(citation.url);
      items.push({
        title: citation.title ?? "Cited source",
        url: citation.url,
        summary: citation.cited_text,
        retrievedAt,
        relevance: 0.9,
        confidence: "MEDIUM",
      });
    }
  }

  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    if (!Array.isArray(block.content)) continue; // WebSearchToolRequestError — skip
    for (const result of block.content) {
      if (seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);
      items.push({
        title: result.title,
        url: result.url,
        summary: `Returned by web search${result.page_age ? ` (page age: ${result.page_age})` : ""}; not directly cited in the answer below.`,
        retrievedAt,
        relevance: 0.5,
        confidence: "LOW",
      });
    }
  }

  for (const block of content) {
    if (block.type !== "text") continue;
    if (block.citations?.length) continue;
    if (block.text.trim()) ungroundedText += block.text.trim() + " ";
  }
  if (ungroundedText.trim()) {
    items.push({
      title: "VOX's synthesis (not directly sourced)",
      url: null,
      summary: ungroundedText.trim(),
      retrievedAt,
      relevance: 0.3,
      confidence: "LOW",
    });
  }

  return items;
}

/**
 * Real research via the Anthropic Messages API's native web_search server
 * tool — reuses the same ANTHROPIC_API_KEY chat already requires, no new
 * vendor. See PHASE_2_ARCHITECTURE.md §2 for why this was chosen (it's the
 * only externally-reachable research option from this project's dev
 * sandbox, and it gives citations that let VOX literally separate retrieved
 * facts from its own reasoning, rather than guessing at the boundary).
 */
export class AnthropicWebSearchProvider implements ResearchProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      timeout: Number(process.env.VOX_AI_TIMEOUT_MS ?? 60_000),
      maxRetries: Number(process.env.VOX_AI_MAX_RETRIES ?? 2),
    });
  }

  async search(query: string): Promise<ResearchResultItem[]> {
    const maxUses = Number(process.env.VOX_WEB_SEARCH_MAX_USES ?? 3);
    const retrievedAt = new Date();

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1536,
        system:
          "Research the user's question using web search and give a concise, well-cited answer. Only state something as fact if a search result supports it.",
        messages: [{ role: "user", content: query }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }],
      });
    } catch (error) {
      logger.error("research.anthropic.search_failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const items = parseWebSearchResponse(response.content, retrievedAt);

    logger.info("research.anthropic.search", {
      query,
      resultCount: items.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return items;
  }
}
