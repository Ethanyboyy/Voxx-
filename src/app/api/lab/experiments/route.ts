import type { NextRequest } from "next/server";
import { createExperimentSchema } from "@/lib/validation/labSchemas";
import { createExperiment, listExperiments, nextExperimentCode } from "@/lib/lab/experiments";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { LabExperimentStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const status = new URL(request.url).searchParams.get("status") as LabExperimentStatus | null;
    const experiments = await listExperiments(user.id, status ?? undefined);
    return jsonOk({ experiments });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createExperimentSchema.parse(await request.json());
    const code = await nextExperimentCode(user.id);
    const experiment = await createExperiment({ userId: user.id, code, ...body });
    return jsonOk({ experiment }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
