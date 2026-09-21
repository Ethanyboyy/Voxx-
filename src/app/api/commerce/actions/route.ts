import { z } from "zod";
import { declareCommercialAction, listCommercialActions } from "@/lib/commerce/execute";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-G] Declaring a commercial action. CREATES NOTHING EXTERNALLY.
 *
 * This route freezes what would be done and returns the digest a human's
 * approval will be bound to. It does not execute, cannot execute, and grants
 * nothing — performing the action is a separate, ACT-gated, individually
 * approved agent step.
 */
const bodySchema = z.object({
  experimentId: z.string().min(1).max(80),
  externalScope: z.string().min(3).max(80),
  code: z.string().min(3).max(32),
  title: z.string().min(3).max(120),
  /** A FRACTION. 0.05 is five percent. A value above 1 is refused by name. */
  percentageFraction: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  usageLimit: z.number(),
  appliesOncePerCustomer: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ actions: await listCommercialActions(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { experimentId, externalScope, ...parameters } = bodySchema.parse(await request.json());

    const result = await declareCommercialAction({
      userId: user.id,
      experimentId,
      externalScope,
      parameters,
    });

    if (!result.declared) {
      if (result.reason === "EXPERIMENT_NOT_FOUND") throw new ApiError(404, "Experiment not found.");
      // The violations are returned verbatim: a caller fixing bounds one at a
      // time learns them by trial and error, which is a worse experience and a
      // worse audit trail than being told all of them at once.
      throw new ApiError(
        result.reason === "INVALID_PARAMETERS" ? 400 : 409,
        result.violations ? `This action is out of bounds: ${result.violations.join(", ")}.` : refusal(result.reason)
      );
    }

    return jsonOk(
      {
        action: { id: result.action.id, status: result.action.status },
        // What the approval will be bound to, and what a person is consenting to.
        contractDigest: result.digest,
        description: result.description,
      },
      201
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function refusal(reason: string): string {
  switch (reason) {
    case "ALREADY_DECLARED":
      return "This experiment already has a commercial action. An experiment that performed two interventions has no single thing whose effect could be measured.";
    case "EXPERIMENT_DISPATCHED":
      return "This experiment has already run. Declaring its intervention now would be describing what happened rather than deciding it.";
    default:
      return "The action could not be declared.";
  }
}
