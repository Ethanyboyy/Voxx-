/**
 * [P4-G] The filtered forensic timeline.
 *
 * A pure read over the EXISTING `Event` table — no second event store, and no
 * fabricated rows. Filtering happens on the server for two reasons: a
 * correlation-scoped query has to reach past the live window, and the tenant
 * boundary must be a `WHERE` clause rather than something the client asked
 * nicely for.
 *
 * Every parameter is validated and every result is scoped to the caller's own
 * `userId`. A correlation id belonging to another account returns an empty
 * page, because it is not a capability — see `getTimeline()`.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { getTimeline, MAX_TIMELINE_PAGE } from "@/lib/volara/timeline";

const filterSchema = z.object({
  agentId: z.string().min(1).max(200).optional(),
  strategyId: z.string().min(1).max(200).optional(),
  opportunityId: z.string().min(1).max(200).optional(),
  allocationId: z.string().min(1).max(200).optional(),
  correlationId: z.string().min(1).max(200).optional(),
  type: z.string().min(1).max(120).optional(),
  consequentialOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TIMELINE_PAGE).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    // Empty strings come from unset form controls and must not become filters —
    // `?agentId=` should mean "no agent filter", not "match the empty id".
    const cleaned = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ""));
    const filter = filterSchema.parse(cleaned);

    return jsonOk(await getTimeline(user.id, filter));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
