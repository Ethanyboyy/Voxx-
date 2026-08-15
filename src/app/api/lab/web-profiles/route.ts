import type { NextRequest } from "next/server";
import { createWebProfileSchema } from "@/lib/validation/labSchemas";
import { createWebProfile, listWebProfiles } from "@/lib/lab/webLab";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const profiles = await listWebProfiles(user.id);
    return jsonOk({ profiles });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createWebProfileSchema.parse(await request.json());
    const profile = await createWebProfile({ userId: user.id, ...body });
    return jsonOk({ profile }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
