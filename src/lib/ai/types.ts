export type ChatRole = "user" | "assistant" | "system";

/**
 * One piece of a message.
 *
 * Added so Visual QA can show a model an image alongside the question about
 * it. Deliberately a discriminated union rather than a loose object, so a new
 * media type is a compile error at every site that switches on it instead of a
 * silently-dropped block.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** Base64-encoded bytes. Never a URL — a URL is someone else's server. */
      data: string;
      /** Must be one of SUPPORTED_IMAGE_MIME_TYPES. */
      mimeType: string;
    };

/**
 * What the vision-capable models actually accept.
 *
 * An allowlist rather than a passthrough: sending an unsupported type produces
 * a provider error at the end of a slow round-trip, and validating up front
 * turns that into an immediate, legible failure.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export function isSupportedImageMimeType(mimeType: string): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * A message to the model.
 *
 * `content` accepts a plain string OR an array of blocks. The string form is
 * kept — not deprecated — because every existing caller in VOX uses it, and
 * widening a type is a change nobody has to react to while replacing one is a
 * change everybody does. Adapters normalise internally.
 */
export interface ChatMessageInput {
  role: ChatRole;
  content: string | ContentBlock[];
}

/** Normalises either content form to blocks, so adapters handle one shape. */
export function toContentBlocks(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/** The text of a message, ignoring any non-text blocks. */
export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Whether a message carries any image block. */
export function hasImageContent(messages: ChatMessageInput[]): boolean {
  return messages.some(
    (message) => typeof message.content !== "string" && message.content.some((block) => block.type === "image"),
  );
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateOptions {
  /** Provider-specific model id. Falls back to the provider's default when omitted. */
  model?: string;
  system?: string;
  messages: ChatMessageInput[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  content: string;
  toolCalls: ToolCall[];
  stopReason: string;
  usage: TokenUsage;
  model: string;
  provider: string;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "message_stop"; stopReason: string; usage: TokenUsage; model: string }
  | { type: "error"; message: string };

/**
 * Provider-agnostic AI abstraction. All model calls in VOX go through an
 * implementation of this interface — never call a provider SDK directly
 * from application code (see CLAUDE.md).
 */
export interface AIProvider {
  readonly id: string;
  readonly defaultModel: string;
  /**
   * Whether this provider can accept image blocks.
   *
   * Optional so no existing implementation breaks; callers treat `undefined`
   * as false. Visual QA checks it rather than discovering the limitation from
   * a provider error, because a provider that silently ignores the image would
   * return a confident judgement about an image it never saw.
   */
  readonly supportsVision?: boolean;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncGenerator<StreamEvent, void, unknown>;
}
