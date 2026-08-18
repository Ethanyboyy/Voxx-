import type { NextRequest } from "next/server";
import { createEconomicAssetSchema } from "@/lib/validation/schemas";
import { createEconomicAsset, listEconomicAssets } from "@/lib/economic/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const assets = await listEconomicAssets(user.id);
    return jsonOk({ assets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createEconomicAssetSchema.parse(await request.json());
    const asset = await createEconomicAsset({ userId: user.id, ...body });
    return jsonOk({ asset }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
