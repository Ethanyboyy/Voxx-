import type { NextRequest } from "next/server";
import { promoteOpportunitySchema } from "@/lib/validation/schemas";
import { promoteOpportunityToProject } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = promoteOpportunitySchema.parse(await request.json().catch(() => ({})));
    const result = await promoteOpportunityToProject(user.id, id, body.projectName);
    if (!result) throw new ApiError(404, "Opportunity not found.");
    return jsonOk(result, result.alreadyPromoted ? 200 : 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
