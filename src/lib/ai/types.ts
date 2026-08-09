export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
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
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncGenerator<StreamEvent, void, unknown>;
}
