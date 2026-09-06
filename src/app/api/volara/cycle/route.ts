/**
 * [P4-F] Runs the Volara runtime.
 *
 * `POST` with `{ agentId }` runs one cycle; without it, one cycle for every
 * schedulable agent. Both go through `runAgentCycle()`, which checks
 * `enforceCapability(userId, "volara.runtime", "RECOMMEND")` before anything
 * else — so this route is not an authorization surface, it is a trigger for one.
 *
 * `PUT` seeds the five agents if they do not exist. Separate from the cycle
 * because creating agents and running them are different acts, and a POST that
 * silently created five agents as a side effect of being called would be a
 * surprise.
 *
 * NOTHING HERE CAN ALLOCATE CAPITAL. A cycle's most consequential output is a
 * `CapitalAllocation` in `REQUESTED`, which reserves nothing. Turning one into a
 * reservation needs `POST /api/volara/capital` and then a human approving the
 * resulting step at the existing endpoint.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { runAgentCycle, runSociety } from "@/lib/volara/loop";
import { ensureVolaraRoster } from "@/lib/volara/roster";
import { superviseSociety } from "@/lib/volara/supervisor";
import { newCorrelationId } from "@/lib/volara/governor";

const cycleSchema = z.object({
  agentId: z.string().min(1).max(200).optional(),
  /** Run the supervisor health sweep alongside the cycles. */
  supervise: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = cycleSchema.parse(await request.json().catch(() => ({})));

    const results = body.agentId
      ? [await runAgentCycle(user.id, body.agentId)]
      : await runSociety(user.id);

    const supervision = body.supervise ? await superviseSociety(user.id, newCorrelationId()) : null;

    return jsonOk({ results, supervision });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT() {
  try {
    const user = await requireUser();
    const agents = await ensureVolaraRoster(user.id);
    return jsonOk({
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        runtimeState: agent.runtimeState,
        autonomyMode: agent.autonomyMode,
        // Surfaced so it is obvious a seeded agent may request nothing yet.
        maxRequestCents: agent.maxRequestCents,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
