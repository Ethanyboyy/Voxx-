import type { NextRequest } from "next/server";
import { updateEngineeringQuestionSchema } from "@/lib/validation/labSchemas";
import { getQuestion, updateQuestion, deleteQuestion } from "@/lib/lab/questions";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const question = await getQuestion(user.id, id);
    if (!question) throw new ApiError(404, "Question not found.");
    return jsonOk({ question });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateEngineeringQuestionSchema.parse(await request.json());
    const question = await updateQuestion(user.id, id, body);
    if (!question) throw new ApiError(404, "Question not found.");
    return jsonOk({ question });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteQuestion(user.id, id);
    if (!deleted) throw new ApiError(404, "Question not found.");
    return jsonOk({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
