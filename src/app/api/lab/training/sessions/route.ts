import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordTrainingSessionSchema } from "@/lib/validation/labSchemas";
import { recordTrainingSession, listTrainingSessions } from "@/lib/lab/training";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

const createSchema = recordTrainingSessionSchema.extend({ moduleId: z.string().min(1) });

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const moduleId = new URL(request.url).searchParams.get("moduleId") ?? undefined;
    const sessions = await listTrainingSessions(user.id, moduleId);
    return jsonOk({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await request.json());
    const session = await recordTrainingSession({ userId: user.id, ...body });
    if (!session) throw new ApiError(404, "Training module not found.");
    return jsonOk({ session }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
