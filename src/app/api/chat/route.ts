import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { addMessage, updateAssistantMessage, buildSystemPrompt, getConversation, toProviderMessages } from "@/lib/chat/service";
import { decideChatAction, describePlan, describeRunOutcome } from "@/lib/chat/action";
import { driveRequest } from "@/lib/capabilities/orchestrator";
import { getRunTrace } from "@/lib/capabilities/trace";
import { chatRequestSchema } from "@/lib/validation/schemas";
import { requireUser, apiErrorResponse, ApiError } from "@/lib/api/helpers";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
};

/**
 * Runs an actionable request through the existing orchestrator and streams the
 * result back on the SAME event protocol the conversational path uses.
 *
 * Reusing `text_delta` / `message_stop` is deliberate: a client that has not
 * been updated still renders the reply correctly, and the extra `run_started`
 * frame is additive. The alternative — a second protocol for orchestrated
 * turns — would mean every consumer of this endpoint learning two shapes.
 *
 * NO MODEL CALL HAPPENS HERE. The plan summary and the final message are both
 * composed from real state (see lib/chat/action.ts). The only provider calls in
 * this path are the ones the orchestrated run itself makes, which the ledger
 * counts.
 */
async function orchestratedResponse(options: {
  userId: string;
  conversationId: string;
  message: string;
  planSummary: string;
}): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // Said before the work starts, so the user is not staring at nothing
        // while a multi-step run executes.
        if (options.planSummary) send({ type: "text_delta", text: `${options.planSummary}\n\n` });

        // The assistant message is persisted BEFORE the work, holding the plan
        // summary and the run id. That is what makes a reload mid-run find an
        // intact conversation: the message is the durable anchor the client
        // reconnects through. It is rewritten with the real outcome when the
        // run settles.
        const placeholder = await addMessage(options.conversationId, "ASSISTANT", options.planSummary, {
          meta: { orchestrated: true, pending: true },
        });

        const result = await driveRequest({
          userId: options.userId,
          request: options.message,
          // Return as soon as the run is durable. A three-attempt image loop
          // would otherwise hold this response open for minutes and be killed
          // by any proxy in between, while the run itself carried on unseen.
          background: true,
          onSettled: async (runId) => {
            // Runs after execution reaches a terminal state, in the background
            // task — this is where the message stops saying "working on it"
            // and starts saying what happened.
            const settled = await getRunTrace(options.userId, { runId });
            await updateAssistantMessage(options.conversationId, placeholder.id, describeRunOutcome(settled), {
              orchestrated: true,
              runId,
              traceId: settled.traceId,
              status: settled.status,
            });
          },
        });

        if (!result.runId) {
          // The router named capabilities but every one of them expanded to
          // nothing runnable — degraded providers, most likely. Falling back to
          // a claim of success would be the exact dishonesty this path exists
          // to avoid.
          const text = "I couldn't turn that into anything I can actually run right now — the capabilities it needs aren't available.";
          await updateAssistantMessage(options.conversationId, placeholder.id, text, {
            orchestrated: true,
            traceId: result.traceId,
            ranNothing: true,
          });
          send({ type: "text_delta", text });
          send({ type: "message_stop", messageId: placeholder.id, usage: { inputTokens: 0, outputTokens: 0 }, model: null });
          return;
        }

        // Link the persisted message to the run before returning, so a reload
        // one second later can find its way back to work still in flight.
        await updateAssistantMessage(options.conversationId, placeholder.id, options.planSummary, {
          orchestrated: true,
          pending: true,
          runId: result.runId,
          traceId: result.traceId,
        });

        send({ type: "run_started", runId: result.runId, traceId: result.traceId });
        // The response ends HERE, with the run still going. Progress reaches
        // the client over the existing event stream; there is no second
        // transport and nothing is fabricated in between.
        send({
          type: "message_stop",
          messageId: placeholder.id,
          usage: { inputTokens: 0, outputTokens: 0 },
          model: null,
          runId: result.runId,
        });
      } catch (error) {
        logger.error("chat.orchestrated.failed", {
          conversationId: options.conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        send({ type: "error", message: "Something went wrong starting that work." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

/**
 * Streams the assistant's reply as newline-delimited JSON events:
 * {"type":"text_delta","text":"..."}
 * {"type":"run_started","runId":"...","traceId":"..."}   (orchestrated turns)
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

  let system: string;
  let trace: Awaited<ReturnType<typeof buildSystemPrompt>>["trace"];
  let providerMessages: ReturnType<typeof toProviderMessages>;
  let provider: ReturnType<typeof getAIProvider>;
  let conversation: NonNullable<Awaited<ReturnType<typeof db.conversation.findFirst>>>;

  try {
    const found = await db.conversation.findFirst({
      where: { id: body.conversationId, userId: user.id },
    });
    if (!found) {
      return apiErrorResponse(new ApiError(404, "Conversation not found."));
    }
    conversation = found;

    await addMessage(conversation.id, "USER", body.message);

    // THE BRANCH. Deterministic and free: `decideChatAction` runs the existing
    // router's deterministic pass with no classifier, so an ordinary message
    // costs nothing to recognise as ordinary. Only a request the router can
    // name capabilities for becomes a run.
    const action = await decideChatAction(body.message);
    if (action.kind === "executable") {
      return orchestratedResponse({
        userId: user.id,
        conversationId: conversation.id,
        message: body.message,
        planSummary: describePlan(action.plan),
      });
    }

    const [systemPromptResult, full] = await Promise.all([
      buildSystemPrompt(user.id, body.message),
      getConversation(user.id, conversation.id),
    ]);
    system = systemPromptResult.prompt;
    trace = systemPromptResult.trace;
    providerMessages = toProviderMessages(full?.messages ?? []);
    provider = getAIProvider();
  } catch (error) {
    logger.error("chat.setup_failed", { error: error instanceof Error ? error.message : String(error) });
    return apiErrorResponse(error);
  }

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
