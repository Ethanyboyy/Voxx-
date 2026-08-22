import type { NextRequest } from "next/server";
import { createAgentSchema } from "@/lib/validation/schemas";
import { createAgent, listAgents } from "@/lib/agents/agents";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/** CRUD for persistent Agent definitions — distinct from /api/agents, which
 * is scoped to AgentRun (a single execution). An Agent is a reusable
 * name + instructions + capability allowlist that a run can optionally be
 * started from (see startAgentRun's agentId param). */
export async function GET() {
  try {
    const user = await requireUser();
    const agents = await listAgents(user.id);
    return jsonOk({ agents });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createAgentSchema.parse(await request.json());
    const agent = await createAgent({ userId: user.id, ...body });
    return jsonOk({ agent }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
