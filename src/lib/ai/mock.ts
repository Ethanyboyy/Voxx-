import type { AIProvider, GenerateOptions, GenerateResult, StreamEvent } from "@/lib/ai/types";

/**
 * Deterministic, zero-network provider used in tests and local development
 * without an API key. Never used in production unless explicitly forced via
 * VOX_AI_PROVIDER=mock.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly defaultModel = "vox-mock-1";

  private reply(options: GenerateOptions): string {
    const lastUser = [...options.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content?.trim() ?? "";
    if (!text) return "I don't have a message to respond to yet.";
    return `[mock response] I heard: "${text.slice(0, 200)}"`;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const content = this.reply(options);
    return {
      content,
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: content.length, outputTokens: content.length },
      model: options.model ?? this.defaultModel,
      provider: this.id,
    };
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const content = this.reply(options);
    const words = content.split(" ");
    for (const word of words) {
      yield { type: "text_delta", text: word + " " };
    }
    yield {
      type: "message_stop",
      stopReason: "end_turn",
      usage: { inputTokens: content.length, outputTokens: content.length },
      model: options.model ?? this.defaultModel,
    };
  }
}
