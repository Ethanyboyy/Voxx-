import type { NextRequest } from "next/server";
import { createObjectiveSchema } from "@/lib/validation/schemas";
import { createObjective, listObjectives } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { ObjectiveStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const status = new URL(request.url).searchParams.get("status") as ObjectiveStatus | null;
    const objectives = await listObjectives(user.id, status ?? undefined);
    return jsonOk({ objectives });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createObjectiveSchema.parse(await request.json());
    const objective = await createObjective({ userId: user.id, ...body });
    return jsonOk({ objective }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
