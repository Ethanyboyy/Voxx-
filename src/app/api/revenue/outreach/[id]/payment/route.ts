import { z } from "zod";
import { confirmOutreachPayment } from "@/lib/revenue/outreach";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [SPRINT] THE ONLY DOOR MONEY COMES THROUGH.
 *
 * Both `processor` and `reference` are REQUIRED, with no default and no
 * optionality: an "it paid, trust me" row is the exact claim the whole economic
 * engine is built not to make, and the reference is what lets somebody other
 * than the person who typed it go and check.
 *
 * THERE IS NO `provenance` FIELD, deliberately. The entry is written
 * `USER_RECORDED` — a person verified it against their processor, VOX did not —
 * and a caller cannot ask for anything else. `REALIZED` remains unreachable
 * from every API in the system until a payment integration exists that reads
 * the charge itself. See `ECONOMIC_INVARIANTS.md#i1`.
 */
const bodySchema = z.object({
  assetId: z.string().min(1).max(80),
  amountCents: z.number().int().positive(),
  processor: z.string().min(1).max(60),
  reference: z.string().min(1).max(200),
  paidAt: z.coerce.date().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());

    const result = await confirmOutreachPayment({ userId: user.id, attemptId: id, ...body });
    if (!result.confirmed) {
      throw new ApiError(result.reason === "NOT_FOUND" ? 404 : result.reason === "INVALID_AMOUNT" || result.reason === "EVIDENCE_INCOMPLETE" ? 400 : 409, result.detail);
    }

    return jsonOk(result, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
