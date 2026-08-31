import { contentToText, hasImageContent } from "@/lib/ai/types";
import type { AIProvider, GenerateOptions, GenerateResult, StreamEvent } from "@/lib/ai/types";

/**
 * Deterministic, zero-network provider used in tests and local development
 * without an API key. Never used in production unless explicitly forced via
 * VOX_AI_PROVIDER=mock.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly defaultModel = "vox-mock-1";
  /**
   * The mock cannot see, and says so.
   *
   * This flag is load-bearing rather than cosmetic. Visual QA checks it and
   * refuses to run without a vision-capable provider — because a mock verdict
   * on an image is a FABRICATED JUDGEMENT about work the model never looked
   * at, and it would be stored as a real QA result, gate a real iteration
   * loop, and mark a real artifact approved.
   */
  readonly supportsVision = false;

  private reply(options: GenerateOptions): string {
    const lastUser = [...options.messages].reverse().find((m) => m.role === "user");
    const text = contentToText(lastUser?.content ?? "").trim();
    // Named explicitly so a text-only transcript of a multimodal call does not
    // read as though the image was considered.
    const sawImage = hasImageContent(options.messages);
    if (!text) return sawImage ? "[mock response] An image was attached, which the mock provider cannot see." : "I don't have a message to respond to yet.";
    return `[mock response] I heard: "${text.slice(0, 200)}"${sawImage ? " (an attached image was not examined)" : ""}`;
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
