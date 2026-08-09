import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { addMessage, buildSystemPrompt, getConversation, toProviderMessages } from "@/lib/chat/service";
import { chatRequestSchema } from "@/lib/validation/schemas";
import { requireUser, apiErrorResponse, ApiError } from "@/lib/api/helpers";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

/**
 * Streams the assistant's reply as newline-delimited JSON events:
 * {"type":"text_delta","text":"..."}
 * {"type":"message_stop","messageId":"...","usage":{...},"model":"..."}
 * {"type":"error","message":"..."}
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return apiErrorResponse(error);
  }

  let body: ReturnType<typeof chatRequestSchema.parse>;
  try {
    body = chatRequestSchema.parse(await request.json());
  } catch (error) {
    return apiErrorResponse(error);
  }

  const conversation = await db.conversation.findFirst({
    where: { id: body.conversationId, userId: user.id },
  });
  if (!conversation) {
    return apiErrorResponse(new ApiError(404, "Conversation not found."));
  }

  await addMessage(conversation.id, "USER", body.message);

  const [{ prompt: system, trace }, full] = await Promise.all([
    buildSystemPrompt(user.id, body.message),
    getConversation(user.id, conversation.id),
  ]);
  const providerMessages = toProviderMessages(full?.messages ?? []);
  const provider = getAIProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        for await (const event of provider.stream({ system, messages: providerMessages })) {
          if (event.type === "text_delta") {
            assistantText += event.text;
            send({ type: "text_delta", text: event.text });
          } else if (event.type === "tool_call") {
            send({ type: "tool_call", toolCall: event.toolCall });
          } else if (event.type === "message_stop") {
            const saved = await addMessage(conversation.id, "ASSISTANT", assistantText, {
              model: event.model,
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              meta: { context: trace },
            });
            send({ type: "message_stop", messageId: saved.id, usage: event.usage, model: event.model, context: trace });
          } else if (event.type === "error") {
            logger.error("chat.stream.provider_error", { conversationId: conversation.id, message: event.message });
            send({ type: "error", message: "The model provider returned an error. Please try again." });
          }
        }
      } catch (error) {
        logger.error("chat.stream.failed", {
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : String(error),
        });
        send({ type: "error", message: "Something went wrong generating a response." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
