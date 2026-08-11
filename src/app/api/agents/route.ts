import type { NextRequest } from "next/server";
import { startAgentRunSchema } from "@/lib/validation/schemas";
import { startAgentRun, listAgentRuns } from "@/lib/agents/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const runs = await listAgentRuns(user.id);
    return jsonOk({ runs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Plans and immediately begins executing — runs until completion, failure, or a permission wait. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = startAgentRunSchema.parse(await request.json());
    const run = await startAgentRun({ userId: user.id, objective: body.objective, projectId: body.projectId });
    return jsonOk({ run }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
