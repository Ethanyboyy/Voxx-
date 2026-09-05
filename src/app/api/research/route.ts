import type { NextRequest } from "next/server";
import { researchRequestSchema } from "@/lib/validation/schemas";
import { listResearchItems } from "@/lib/research/service";
import { startAgentRun } from "@/lib/agents/service";
import { db } from "@/lib/db";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const opportunityId = new URL(request.url).searchParams.get("opportunityId");
    const items = await listResearchItems(user.id, 50, opportunityId ?? undefined);
    return jsonOk({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * [P4-D] Research now runs THROUGH the executor rather than beside it.
 *
 * This route used to call the research service directly, which meant the single
 * operation that pulls untrusted web content into VOX's memory and knowledge
 * graph was enforced when an agent ran it and unenforced when a person posted
 * here. Two doors to one room, one of them unlocked.
 *
 * Rather than build a second authorization path for this route, it now creates
 * the same thing the agent framework would: a one-step run whose tool is
 * `research.run`. Everything P4-C1/C2/C3 built then applies unchanged —
 * argument finalization, the canonical hash, the policy decision, the approval
 * match, single-use consumption, the audit trail, and the existing approval
 * endpoint and UI. No new table, no new approval target, no second primitive.
 *
 * The response says which of the two things happened:
 *   - `status: "COMPLETED"` — the research ran; `items` are the findings.
 *   - `status: "WAITING_FOR_PERMISSION"` — the policy holds it, and `runId` /
 *     `stepId` name the pending approval to act on.
 *
 * The arguments come from the validated body but are never trusted as
 * authority: they become an AgentStep input, and the executor re-reads and
 * re-hashes that row before deciding anything.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = researchRequestSchema.parse(await request.json());

    const run = await startAgentRun({
      userId: user.id,
      objective: `Research: ${body.query}`,
      steps: [
        {
          description: `Research "${body.query}".`,
          toolName: "research.run",
          input: {
            query: body.query,
            ...(body.opportunityId ? { opportunityId: body.opportunityId } : {}),
            ...(body.objectiveId ? { objectiveId: body.objectiveId } : {}),
          },
        },
      ],
    });

    if (run.status !== "COMPLETED") {
      const pending = run.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
      return jsonOk(
        {
          status: run.status,
          runId: run.id,
          stepId: pending?.id ?? null,
          capability: pending?.capability ?? null,
          requiredLevel: pending?.requiredLevel ?? null,
          error: run.error,
          items: [],
        },
        // 202: accepted and recorded, not performed. A 201 here would claim a
        // result that does not exist yet.
        202
      );
    }

    // The findings this run produced, read back the way any other reader sees
    // them rather than passed through from the tool's return value.
    const items = await db.researchItem.findMany({
      where: { userId: user.id, query: body.query },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return jsonOk({ status: run.status, runId: run.id, items }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
