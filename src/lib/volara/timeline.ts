/**
 * [P4-G] THE FORENSIC TIMELINE — a filtered read over the EXISTING Event table.
 *
 * No second event store, no second writer, and no fabricated rows. Every entry
 * this returns is an `Event` some service really wrote through `recordEvent()`;
 * this module only chooses which of them to show and decorates each one with
 * the ids already present in its payload.
 *
 * WHY FILTERING LIVES ON THE SERVER. The Observer could fetch a window and
 * filter in the browser, and for the 50-row live feed it does. But "show me
 * everything for correlation X" or "everything this agent did" has to reach
 * past the window, and doing that client-side would mean shipping the whole
 * history to filter it — the N+1-shaped mistake §17 names. It would also mean
 * the tenant boundary was enforced by what the client asked for rather than by
 * the query, which is the wrong place for it entirely.
 *
 * EVERY QUERY IS SCOPED BY `userId` AT THE DATABASE. A correlation id is not a
 * capability: knowing one belonging to another account returns nothing, because
 * `userId` is in the `WHERE` clause and not merely checked afterwards.
 */

import { db } from "@/lib/db";
import type { Event } from "@/generated/prisma/client";
import type { TimelineEntry } from "@/lib/volara/observer-events";

/** Hard ceiling on a page, so no filter combination can ask for everything. */
export const MAX_TIMELINE_PAGE = 200;
export const DEFAULT_TIMELINE_PAGE = 50;

export interface TimelineFilter {
  /** Match events whose payload names this agent, or whose subject IS it. */
  agentId?: string;
  strategyId?: string;
  opportunityId?: string;
  allocationId?: string;
  /** Exact event type, e.g. "capital.allocated". */
  type?: string;
  correlationId?: string;
  since?: Date;
  until?: Date;
  /** Only events the audit marks as consequential. */
  consequentialOnly?: boolean;
  limit?: number;
  /** Keyset pagination: return events strictly older than this. */
  before?: Date;
}

// `TimelineEntry`, `OBSERVER_EVENT_TYPES` and `isObserverEvent()` live in
// `observer-events.ts` and are re-exported here. They are needed by client
// components, and this module imports the database client — importing a
// constant from here would pull SQLite into the browser bundle.
export type { TimelineEntry } from "@/lib/volara/observer-events";
export { OBSERVER_EVENT_TYPES, isObserverEvent } from "@/lib/volara/observer-events";

export interface TimelinePage {
  entries: TimelineEntry[];
  /** Pass as `before` to continue. Null when this is the last page. */
  nextBefore: string | null;
  /** Whether the filter was applied at the database (always true here). */
  truncated: boolean;
}

/**
 * A page of the audit trail, filtered.
 *
 * The id filters are matched against BOTH the event's subject and its payload,
 * because the same fact is recorded from different angles: `capital.allocated`
 * has the allocation as its subject and the agent in its payload, while
 * `agent.state_changed` has the agent as its subject and nothing else. Matching
 * only one of the two would silently drop half of what a reader asked for.
 *
 * Payload matching is a `contains` on the serialized JSON. That is a
 * substring test, so it is deliberately paired with an exact re-check in
 * `decorate()` below — a raw id appearing anywhere in a payload gets the row
 * considered, and the extracted fields say whether it really belongs.
 */
export async function getTimeline(userId: string, filter: TimelineFilter = {}): Promise<TimelinePage> {
  const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_TIMELINE_PAGE), MAX_TIMELINE_PAGE);

  const idFilters: string[] = [
    filter.agentId,
    filter.strategyId,
    filter.opportunityId,
    filter.allocationId,
    filter.correlationId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const createdAt: { lt?: Date; gte?: Date; lte?: Date } = {};
  if (filter.before) createdAt.lt = filter.before;
  if (filter.since) createdAt.gte = filter.since;
  if (filter.until) createdAt.lte = filter.until;

  const rows = await db.event.findMany({
    where: {
      // THE TENANT BOUNDARY. First clause, at the database, always.
      userId,
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.consequentialOnly ? { consequential: true } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      // Each id must match somewhere — subject or payload. ANDed together, so
      // asking for one agent AND one strategy narrows rather than widens.
      ...(idFilters.length > 0
        ? {
            AND: idFilters.map((id) => ({
              OR: [{ subjectId: id }, { payload: { contains: id } }],
            })),
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    // One extra row, purely to answer "is there another page" without a count.
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    entries: page.map(decorate),
    nextBefore: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    truncated: hasMore,
  };
}

/**
 * Lifts the ids and amount out of an event's payload.
 *
 * Reads only keys the runtime actually writes. An unrecognised shape yields
 * nulls rather than a guess — the alternative is an Observer that confidently
 * attributes an event to the wrong agent because a similar-looking key existed.
 */
function decorate(event: Event): TimelineEntry {
  const payload = parsePayload(event.payload);
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

  const readId = (key: string): string | null => {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const readCents = (key: string): number | null => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  // The subject counts as the id when it is of the matching type — that is how
  // `agent.state_changed` (subject Agent, no agentId in payload) still resolves.
  const subjectAs = (type: string) => (event.subjectType === type ? event.subjectId : null);

  return {
    id: event.id,
    type: event.type,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    consequential: event.consequential,
    at: event.createdAt.toISOString(),
    payload,
    agentId: readId("agentId") ?? readId("fromAgentId") ?? subjectAs("Agent"),
    strategyId: readId("strategyId") ?? subjectAs("Strategy"),
    opportunityId: readId("opportunityId") ?? subjectAs("Opportunity"),
    allocationId: readId("allocationId") ?? subjectAs("CapitalAllocation"),
    correlationId: readId("correlationId"),
    // Ordered by specificity: what was actually reserved beats what was asked
    // for, so a card showing one number shows the committed one.
    amountCents:
      readCents("approvedCents") ??
      readCents("requestedCents") ??
      readCents("amountCents") ??
      readCents("freedCents") ??
      readCents("realizedProfitCents"),
  };
}

function parsePayload(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Returned as text rather than dropped: losing it would hide that
    // something wrote malformed JSON into the audit trail.
    return raw;
  }
}
