import type { NextRequest } from "next/server";
import { completeTutorialSchema } from "@/lib/validation/labSchemas";
import { completeTutorial } from "@/lib/lab/tutorials";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { score } = completeTutorialSchema.parse(await request.json());
    const progress = await completeTutorial(user.id, id, score);
    return jsonOk({ progress }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
