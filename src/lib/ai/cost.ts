import type { TokenUsage } from "@/lib/ai/types";

/**
 * VOX always records real token usage from provider responses. Turning that
 * into a dollar estimate requires a price the app cannot verify on its own,
 * so cost is only computed when the user supplies real per-1K-token rates —
 * otherwise VOX reports token counts and stays silent on cost rather than
 * fabricate a number.
 */
export function estimateCostUsd(usage: TokenUsage): number | null {
  const inputRate = process.env.VOX_COST_PER_1K_INPUT_TOKENS;
  const outputRate = process.env.VOX_COST_PER_1K_OUTPUT_TOKENS;
  if (!inputRate || !outputRate) return null;

  const inputPer1k = Number(inputRate);
  const outputPer1k = Number(outputRate);
  if (Number.isNaN(inputPer1k) || Number.isNaN(outputPer1k)) return null;

  return (usage.inputTokens / 1000) * inputPer1k + (usage.outputTokens / 1000) * outputPer1k;
}
