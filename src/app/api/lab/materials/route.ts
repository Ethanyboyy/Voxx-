import type { NextRequest } from "next/server";
import { createMaterialSchema } from "@/lib/validation/labSchemas";
import { createMaterial, listMaterials } from "@/lib/lab/materials";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const category = new URL(request.url).searchParams.get("category") ?? undefined;
    const materials = await listMaterials(user.id, category);
    return jsonOk({ materials });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createMaterialSchema.parse(await request.json());
    const material = await createMaterial({ userId: user.id, ...body });
    return jsonOk({ material }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
