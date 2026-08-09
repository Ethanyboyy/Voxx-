import type { NextRequest } from "next/server";
import { createExperimentSchema } from "@/lib/validation/schemas";
import { createExperiment, listExperiments } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const experiments = await listExperiments(user.id, projectId);
    return jsonOk({ experiments });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createExperimentSchema.parse(await request.json());
    const experiment = await createExperiment({ userId: user.id, ...body });
    return jsonOk({ experiment }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
