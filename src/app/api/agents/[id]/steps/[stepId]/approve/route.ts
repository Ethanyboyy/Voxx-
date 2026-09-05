/**
 * [P4-C2] THE HUMAN APPROVAL ENDPOINT.
 *
 * This is the one HTTP surface in VOX at which a person's decision becomes an
 * `ApprovalGrant`. It is a separate route on purpose, not a flag folded into
 * resume: resume says "try again", approval says "I consent to THIS action with
 * THESE arguments", and hiding the second inside the first would make retrying
 * indistinguishable from authorizing.
 *
 * GET creates nothing. Reading a pending action, loading the page, polling —
 * none of it is approval, so the read path never writes a grant.
 *
 * POST is the approval act, and the body is exactly one field: the hash of the
 * arguments the person was shown. Everything else the grant records — action,
 * arguments, capability, required level, classification, policy decision,
 * target — is read from the persisted `AgentStep` and the frozen registry by
 * `approveAgentStep()`. A caller that bypasses the UI entirely still cannot
 * name its own action; the worst it can do is assert a hash that does not
 * match, which is refused.
 */

import type { NextRequest } from "next/server";
import { getPendingStepApproval, approveAgentStep } from "@/lib/policy/step-approvals";
import { approveAgentStepSchema } from "@/lib/validation/schemas";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import { refusalResponse } from "../refusal";

type Context = { params: Promise<{ id: string; stepId: string }> };

/** What is waiting, as the server sees it. A pure read — no grant is created here. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { id, stepId } = await context.params;
    const result = await getPendingStepApproval(user.id, id, stepId);
    if (!result.found) return refusalResponse(result.reason);
    return jsonOk({ pending: result.pending });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The approval act. Creates an ApprovalGrant only after every server-side check passes. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const { id, stepId } = await context.params;
    const body = approveAgentStepSchema.parse(await request.json());

    // The user id comes from the session, the run and step from the URL, the
    // hash from the body. Nothing else crosses this boundary.
    const result = await approveAgentStep({
      userId: user.id,
      runId: id,
      stepId,
      argumentsHash: body.argumentsHash,
    });
    if (!result.approved) return refusalResponse(result.reason);

    return jsonOk(
      {
        approved: true,
        reused: result.reused,
        grant: {
          id: result.grant.id,
          actionId: result.grant.actionId,
          argumentsHash: result.grant.argumentsHash,
          expiresAt: result.grant.expiresAt,
        },
      },
      result.reused ? 200 : 201
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
