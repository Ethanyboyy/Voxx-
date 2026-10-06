import { z } from "zod";
import { corroborationPlan } from "@/lib/discovery/corroboration";
import { listDiscoveryRuns, runDiscovery } from "@/lib/discovery/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-C] DISCOVERY, over HTTP.
 *
 * GET  recent passes with their candidates, plus the corroboration plan —
 *      which figure on which opportunity is blocking capital, and what would
 *      clear it.
 * POST runs a pass. Gated on the `economic.discover` capability at RECOMMEND,
 *      which is above the default granted level, so discovery is off until
 *      somebody turns it on.
 *
 * WHAT A SUCCESSFUL POST DOES NOT DO. It reserves no capital, creates no
 * permission, mints no `ApprovalGrant` and executes nothing externally. Every
 * figure it writes is `MODEL_SUGGESTED`, which `capitalBasisGate()` refuses, so
 * the most a pass can achieve is putting a candidate in front of a person with
 * the specific claims that would need corroborating named.
 */

const bodySchema = z.object({
  objectiveId: z.string().min(1).max(80),
  brief: z.string().min(10).max(2000),
  focus: z.string().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const discoveredOnly = new URL(request.url).searchParams.get("discoveredOnly") === "1";

    const [runs, corroboration] = await Promise.all([
      listDiscoveryRuns(user.id),
      corroborationPlan(user.id, { discoveredOnly }),
    ]);

    return jsonOk({
      runs,
      corroboration,
      note: "Every figure a discovery pass produces is a model hypothesis. None is verified, measured or fundable.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());

    const result = await runDiscovery({
      userId: user.id,
      objectiveId: body.objectiveId,
      brief: body.brief,
      focus: body.focus,
    });

    const accepted = result.outcomes.filter((o) => o.status === "ACCEPTED");
    return jsonOk({
      runId: result.run.id,
      // A refusal is a 200 with the reason, not an error: the pass ran and the
      // honest answer is "nothing". Returning 5xx would read as a malfunction.
      refused: result.refused,
      refusalReason: result.run.refusalReason,
      refusalDetail: result.run.refusalDetail,
      accepted: accepted.length,
      rejected: result.outcomes.length - accepted.length,
      outcomes: result.outcomes,
      basis: "MODEL_SUGGESTED",
      note: "Recorded as model hypotheses. Nothing here can reserve capital until each figure is corroborated on its own evidence.",
    });
  } catch (error) {
    // `apiErrorResponse` already maps `PermissionDeniedError` to 403 with the
    // capability and level attached, so an ungranted account gets the specific
    // refusal rather than a generic failure.
    return apiErrorResponse(error);
  }
}
