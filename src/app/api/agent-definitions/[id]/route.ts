import type { NextRequest } from "next/server";
import { updateAgentSchema } from "@/lib/validation/schemas";
import { getAgent, updateAgent, deleteAgent } from "@/lib/agents/agents";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const agent = await getAgent(user.id, id);
    if (!agent) throw new ApiError(404, "Agent not found.");
    return jsonOk({ agent });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateAgentSchema.parse(await request.json());
    const agent = await updateAgent(user.id, id, body);
    if (!agent) throw new ApiError(404, "Agent not found.");
    return jsonOk({ agent });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteAgent(user.id, id);
    if (!deleted) throw new ApiError(404, "Agent not found.");
    return jsonOk({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
