import type { NextRequest } from "next/server";
import { updateEconomicAssetSchema } from "@/lib/validation/schemas";
import { deleteEconomicAsset, getEconomicAsset, updateEconomicAsset } from "@/lib/economic/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const asset = await getEconomicAsset(user.id, id);
    if (!asset) throw new ApiError(404, "Asset not found.");
    return jsonOk({ asset });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateEconomicAssetSchema.parse(await request.json());
    const asset = await updateEconomicAsset(user.id, id, body);
    if (!asset) throw new ApiError(404, "Asset not found.");
    return jsonOk({ asset });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const ok = await deleteEconomicAsset(user.id, id);
    if (!ok) throw new ApiError(404, "Asset not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
