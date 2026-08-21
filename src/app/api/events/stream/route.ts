import type { NextRequest } from "next/server";
import { subscribeToEvents } from "@/lib/events/bus";
import { requireUser, apiErrorResponse } from "@/lib/api/helpers";

export const runtime = "nodejs";

const HEARTBEAT_MS = 25000;

/**
 * Server-Sent Events stream of this user's real events, pushed live by
 * recordEvent() via src/lib/events/bus.ts — never a fabricated or synthetic
 * tick. One `data: {...}\n\n` frame per real Event row, plus a `:heartbeat`
 * comment frame every 25s so intermediate proxies don't time out an
 * otherwise-idle connection.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch (error) {
    return apiErrorResponse(error);
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // controller already closed (client disconnected mid-write) — the
          // abort listener below will clean up.
        }
      };

      send(": connected\n\n");
      unsubscribe = subscribeToEvents(userId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  request.signal.addEventListener("abort", () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
