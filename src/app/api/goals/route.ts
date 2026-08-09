import type { NextRequest } from "next/server";
import { createGoalSchema } from "@/lib/validation/schemas";
import { createGoal, listGoals } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const goals = await listGoals(user.id, projectId);
    return jsonOk({ goals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createGoalSchema.parse(await request.json());
    const goal = await createGoal({ userId: user.id, ...body });
    return jsonOk({ goal }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
