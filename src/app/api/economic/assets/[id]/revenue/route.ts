import type { NextRequest } from "next/server";
import { addEconomicLedgerEntrySchema } from "@/lib/validation/schemas";
import { addEconomicRevenue } from "@/lib/economic/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = addEconomicLedgerEntrySchema.parse(await request.json());
    const revenue = await addEconomicRevenue(user.id, id, body);
    if (!revenue) throw new ApiError(404, "Asset not found.");
    return jsonOk({ revenue }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
