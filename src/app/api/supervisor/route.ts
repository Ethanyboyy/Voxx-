import type { NextRequest } from "next/server";
import { startSupervisorRunSchema } from "@/lib/validation/schemas";
import { startSupervisorRun, listSupervisorRuns } from "@/lib/supervisor/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const runs = await listSupervisorRuns(user.id);
    return jsonOk({ runs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Understands an objective and drives it autonomously (plan -> select/create agent -> execute) until completion, a genuine approval boundary, or a bounded failure. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = startSupervisorRunSchema.parse(await request.json());
    const run = await startSupervisorRun({ userId: user.id, objectiveId: body.objectiveId, maxIterations: body.maxIterations });
    return jsonOk({ run }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
