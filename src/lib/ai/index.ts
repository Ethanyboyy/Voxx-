import { AnthropicProvider } from "@/lib/ai/anthropic";
import { MockAIProvider } from "@/lib/ai/mock";
import type { AIProvider } from "@/lib/ai/types";

export type { AIProvider, GenerateOptions, GenerateResult, StreamEvent, ToolCall, ToolDefinition } from "@/lib/ai/types";

let cached: AIProvider | null = null;

/**
 * Resolves the active AI provider. Set VOX_AI_PROVIDER=mock to force the
 * mock provider (used automatically in tests); otherwise Anthropic is used
 * when ANTHROPIC_API_KEY is present, and mock is the safe fallback so the
 * app still runs without a key configured.
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const forced = process.env.VOX_AI_PROVIDER;
  if (forced === "mock") {
    cached = new MockAIProvider();
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  cached = apiKey ? new AnthropicProvider(apiKey) : new MockAIProvider();
  return cached;
}

/** Test-only hook to reset the cached provider between specs. */
export function _resetAIProviderCache(): void {
  cached = null;
}
