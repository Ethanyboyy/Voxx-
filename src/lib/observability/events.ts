import { db } from "@/lib/db";
import { logger } from "@/lib/observability/logger";

export interface RecordEventInput {
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
  consequential?: boolean;
}

/**
 * Append-only audit trail. Every consequential action (capability level
 * RECOMMEND and above) must call this. Also used for lower-signal
 * operational events (errors, retrieval failures) surfaced in diagnostics.
 */
export async function recordEvent(input: RecordEventInput) {
  const event = await db.event.create({
    data: {
      userId: input.userId,
      type: input.type,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      consequential: input.consequential ?? false,
    },
  });
  logger.info("event.recorded", { type: input.type, consequential: event.consequential });
  return event;
}

export async function listRecentEvents(userId: string, limit = 50) {
  return db.event.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
