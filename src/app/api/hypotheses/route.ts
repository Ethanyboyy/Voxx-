import type { NextRequest } from "next/server";
import { createHypothesisSchema, hypothesisStatusSchema } from "@/lib/validation/schemas";
import { createHypothesis, listHypotheses } from "@/lib/cognition/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const statusParam = new URL(request.url).searchParams.get("status");
    const status = statusParam ? hypothesisStatusSchema.parse(statusParam) : undefined;
    const hypotheses = await listHypotheses(user.id, status);
    return jsonOk({ hypotheses });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createHypothesisSchema.parse(await request.json());
    const hypothesis = await createHypothesis({ userId: user.id, ...body });
    return jsonOk({ hypothesis }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
