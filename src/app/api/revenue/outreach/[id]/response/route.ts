import { z } from "zod";
import { recordOutreachResponse } from "@/lib/revenue/outreach";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [SPRINT] WHAT THE PROSPECT SAID.
 *
 * `PAID` IS NOT IN THIS SCHEMA. Money has exactly one door — the payment
 * endpoint — and that one requires the processor and the transaction reference.
 * Leaving PAID out of the enum here means a caller cannot mark revenue without
 * evidence even by mistake; the service refuses it too, so the schema is the
 * outer of two layers rather than the only one.
 */
const bodySchema = z.object({
  outcome: z.enum(["NO_RESPONSE", "REPLIED", "INTERESTED", "AGREED", "DECLINED", "DISQUALIFIED"]),
  respondedAt: z.coerce.date().optional(),
  notes: z.string().max(2000).nullish(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());

    const result = await recordOutreachResponse(user.id, id, body.outcome, {
      respondedAt: body.respondedAt,
      notes: body.notes,
    });
    if (!result.recorded) {
      throw new ApiError(result.reason === "NOT_FOUND" ? 404 : 409, result.detail);
    }

    return jsonOk({ recorded: true, outcome: result.outcome });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
