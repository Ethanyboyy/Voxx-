import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { driveRequest } from "@/lib/capabilities/driver";

/**
 * Route one request and run the plan it produces.
 *
 * No permission check here, deliberately. Every consequential step goes
 * through the executor's own checkCapability() as it is reached, which is the
 * single authorization hierarchy the whole system uses; a second gate on this
 * route would be a different set of rules to keep in sync, and the weaker of
 * the two would become the real one. Routing itself performs nothing.
 *
 * The reference ids are artifact VERSION ids, not paths or URLs — the artifact
 * service resolves them against rows this user owns, so a caller cannot name
 * an arbitrary file as a reference.
 */
const driveSchema = z.object({
  request: z.string().min(1).max(4000),
  referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
  subjectType: z.string().max(60).optional(),
  subjectId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = driveSchema.parse(await request.json());

    const result = await driveRequest({ userId: user.id, ...body });

    return jsonOk(
      {
        traceId: result.traceId,
        runId: result.runId,
        // The plan as a list of capabilities and one-line reasons. This is the
        // routing DECISION, which the user is entitled to see; it is not the
        // model's reasoning, which is never persisted or returned.
        plan: {
          strategy: result.plan.strategy,
          degraded: result.plan.degraded,
          notes: result.plan.notes,
          steps: result.plan.steps.map((s) => ({
            capability: s.capability,
            reason: s.reason,
            optional: s.optional,
          })),
        },
      },
      result.runId ? 201 : 200,
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
