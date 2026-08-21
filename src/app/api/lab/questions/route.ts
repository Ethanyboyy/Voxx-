import type { NextRequest } from "next/server";
import { createEngineeringQuestionSchema } from "@/lib/validation/labSchemas";
import { createQuestion, listQuestions } from "@/lib/lab/questions";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const suitId = searchParams.get("suitId") ?? undefined;
    const resolvedParam = searchParams.get("resolved");
    const resolved = resolvedParam === null ? undefined : resolvedParam === "true";
    const questions = await listQuestions(user.id, suitId, resolved);
    return jsonOk({ questions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createEngineeringQuestionSchema.parse(await request.json());
    const question = await createQuestion({ userId: user.id, ...body });
    return jsonOk({ question }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
