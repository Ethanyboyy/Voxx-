import type { NextRequest } from "next/server";
import { addEconomicLedgerEntrySchema } from "@/lib/validation/schemas";
import { addEconomicExpense } from "@/lib/economic/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = addEconomicLedgerEntrySchema.parse(await request.json());
    const expense = await addEconomicExpense(user.id, id, body);
    if (!expense) throw new ApiError(404, "Asset not found.");
    return jsonOk({ expense }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
