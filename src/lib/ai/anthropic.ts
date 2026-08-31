import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/observability/logger";
import { isSupportedImageMimeType, toContentBlocks } from "@/lib/ai/types";
import type {
  AIProvider,
  ChatMessageInput,
  GenerateOptions,
  GenerateResult,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "@/lib/ai/types";

const DEFAULT_MODEL = process.env.VOX_ANTHROPIC_MODEL ?? "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 4096;

function toAnthropicTools(tools: ToolDefinition[] | undefined): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
  }));
}


/**
 * VOX message content -> Anthropic content.
 *
 * A plain string is passed straight through rather than wrapped in a
 * single-element block array. Both are valid to the API, but keeping the
 * string form means this change is invisible on the wire for every existing
 * text-only caller — which is the point of widening the type rather than
 * replacing it.
 *
 * Image blocks use the SDK's base64 source shape. The MIME type is checked
 * here, not just at the caller, because this is the last place before the
 * request leaves: an unsupported type produces a slow 400 from the API, and a
 * local throw names the actual problem.
 */
function toAnthropicContent(content: ChatMessageInput["content"]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;

  return toContentBlocks(content).map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (!isSupportedImageMimeType(block.mimeType)) {
      throw new Error(
        `Unsupported image type "${block.mimeType}" — Anthropic accepts png, jpeg, gif and webp.`,
      );
    }
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: block.mimeType, data: block.data },
    };
  });
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly defaultModel = DEFAULT_MODEL;
  /** Every current Claude model accepts image blocks. */
  readonly supportsVision = true;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      timeout: Number(process.env.VOX_AI_TIMEOUT_MS ?? 60_000),
      maxRetries: Number(process.env.VOX_AI_MAX_RETRIES ?? 2),
    });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.defaultModel;
    const start = Date.now();

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.system,
        temperature: options.temperature,
        messages: options.messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role as "user" | "assistant",
          content: toAnthropicContent(m.content),
        })),
        tools: toAnthropicTools(options.tools),
      });

      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const toolCalls: ToolCall[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }));

      logger.info("ai.generate", {
        provider: this.id,
        model,
        latencyMs: Date.now() - start,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      });

      return {
        content,
        toolCalls,
        stopReason: response.stop_reason ?? "end_turn",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model,
        provider: this.id,
      };
    } catch (error) {
      logger.error("ai.generate.failed", {
        provider: this.id,
        model,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const model = options.model ?? this.defaultModel;
    const start = Date.now();

    interface BlockAccumulator {
      type: "text" | "tool_use";
      id?: string;
      name?: string;
      text: string;
      jsonBuffer: string;
    }
    const blocks = new Map<number, BlockAccumulator>();

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.system,
        temperature: options.temperature,
        messages: options.messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role as "user" | "assistant",
          content: toAnthropicContent(m.content),
        })),
        tools: toAnthropicTools(options.tools),
      });

      let stopReason = "end_turn";
      const usage = { inputTokens: 0, outputTokens: 0 };

      for await (const event of stream) {
        if (event.type === "message_start") {
          usage.inputTokens = event.message.usage.input_tokens;
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            blocks.set(event.index, {
              type: "tool_use",
              id: event.content_block.id,
              name: event.content_block.name,
              text: "",
              jsonBuffer: "",
            });
          } else {
            blocks.set(event.index, { type: "text", text: "", jsonBuffer: "" });
          }
        } else if (event.type === "content_block_delta") {
          const block = blocks.get(event.index);
          if (!block) continue;
          if (event.delta.type === "text_delta") {
            block.text += event.delta.text;
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            block.jsonBuffer += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const block = blocks.get(event.index);
          if (block?.type === "tool_use" && block.id && block.name) {
            let input: Record<string, unknown> = {};
            try {
              input = block.jsonBuffer ? JSON.parse(block.jsonBuffer) : {};
            } catch {
              logger.warn("ai.stream.tool_input_parse_failed", { provider: this.id, model });
            }
            yield { type: "tool_call", toolCall: { id: block.id, name: block.name, input } };
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
          if (event.usage?.output_tokens) usage.outputTokens = event.usage.output_tokens;
        }
      }

      logger.info("ai.stream", {
        provider: this.id,
        model,
        latencyMs: Date.now() - start,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        stopReason,
      });

      yield { type: "message_stop", stopReason, usage, model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("ai.stream.failed", {
        provider: this.id,
        model,
        latencyMs: Date.now() - start,
        error: message,
      });
      yield { type: "error", message };
    }
  }
}
