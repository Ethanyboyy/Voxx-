import type { NextRequest } from "next/server";
import { createSuitSchema } from "@/lib/validation/labSchemas";
import { createSuit, listSuits } from "@/lib/lab/suits";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { LabDesignStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as LabDesignStatus | null;
    const projectId = url.searchParams.get("projectId");
    const suits = await listSuits(user.id, { status: status ?? undefined, projectId: projectId ?? undefined });
    return jsonOk({ suits });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSuitSchema.parse(await request.json());
    const suit = await createSuit({ userId: user.id, ...body });
    return jsonOk({ suit }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
