import { db } from "@/lib/db";
import { logger } from "@/lib/observability/logger";

export interface RecordEventInput {
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
  consequential?: boolean;
  /** Descriptive-only subject reference (e.g. "Task"/id) — not a foreign key,
   * so the event stays readable after the subject is deleted. */
  subjectType?: string;
  subjectId?: string;
}

/**
 * Append-only audit trail AND durable domain timeline: every consequential
 * action (capability level RECOMMEND and above) must call this, as should
 * every notable domain state change (task completed, goal changed, research
 * discovered, memory updated/superseded, decision made, experiment result,
 * project milestone) — see PHASE_2_ARCHITECTURE.md §4.
 */
export async function recordEvent(input: RecordEventInput) {
  const event = await db.event.create({
    data: {
      userId: input.userId,
      type: input.type,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      consequential: input.consequential ?? false,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  });
  logger.info("event.recorded", { type: input.type, consequential: event.consequential });
  return event;
}

export interface ListEventsFilter {
  subjectType?: string;
  subjectId?: string;
  limit?: number;
}

export async function listRecentEvents(userId: string, limitOrFilter: number | ListEventsFilter = 50) {
  const filter: ListEventsFilter = typeof limitOrFilter === "number" ? { limit: limitOrFilter } : limitOrFilter;
  return db.event.findMany({
    where: { userId, subjectType: filter.subjectType, subjectId: filter.subjectId },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 50,
  });
}
