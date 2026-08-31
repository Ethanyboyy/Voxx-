import type { NextRequest } from "next/server";
import { suitInteractionSchema } from "@/lib/validation/labSchemas";
import { recordSuitInteraction, UnknownSuitError } from "@/lib/lab/interactions";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/**
 * Records one Suit Bay interaction against the calling user's timeline.
 *
 * The event type is constrained by the interaction registry at both the schema
 * and the service, so this endpoint cannot be used to write an arbitrary event
 * type into the audit trail.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = suitInteractionSchema.parse(await request.json());
    const event = await recordSuitInteraction({ userId: user.id, ...body });
    return jsonOk({ event: { id: event.id, type: event.type, createdAt: event.createdAt } }, 201);
  } catch (error) {
    // A suit id that does not resolve for this user is a bad request, not a
    // server fault — and it must not say whether the id exists for anyone else.
    if (error instanceof UnknownSuitError) {
      return apiErrorResponse(new ApiError(404, "Suit not found."));
    }
    return apiErrorResponse(error);
  }
}
