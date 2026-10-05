import { z } from "zod";
import { ECONOMIC_FIGURES } from "@/lib/economic/figures";
import { getOpportunityModel } from "@/lib/economic/opportunityModel";
import { listEstimates, recordEstimate, upgradeEstimate } from "@/lib/economic/provenance";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import type { EconomicFigure } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/**
 * [P6-B] PER-FIGURE PROVENANCE, over HTTP.
 *
 * Three verbs, and the split between POST and PATCH is the point:
 *
 *   GET    what is known about each figure, and what blocks capital.
 *   POST   STATE what is known now. Any basis, either direction.
 *   PATCH  CLAIM that a figure is now better evidenced. Refuses anything that
 *          is not a rank increase, and demands the evidence that rank requires.
 *
 * A single `PUT /estimates` taking a basis would make every write look like an
 * improvement, and "upgraded" in the event log would stop meaning anything.
 *
 * WHAT THIS ENDPOINT CANNOT DO. It records what a number rests on. It does not
 * allocate capital, create a permission, mint an `ApprovalGrant` or execute
 * anything — a figure becoming capital-eligible is a statement about evidence,
 * and committing the money still goes through `requestCapital()` and a human's
 * grant exactly as P4-F built it.
 */

const FIGURES = ECONOMIC_FIGURES as [EconomicFigure, ...EconomicFigure[]];

/**
 * Evidence references. Note what is NOT accepted: a free-text "evidence"
 * string. A `MEASURED` or `COMPARABLE` basis has to name a row, and the service
 * then checks that the row exists and belongs to this user — otherwise the
 * strongest basis in the system would be the easiest one to type.
 */
const evidenceSchema = z
  .object({
    experimentId: z.string().min(1).optional(),
    measurementId: z.string().min(1).optional(),
    researchItemId: z.string().min(1).optional(),
    comparableId: z.string().min(1).optional(),
  })
  .optional();

const recordSchema = z.object({
  figure: z.enum(FIGURES),
  value: z.number(),
  basis: z.enum(["MODEL_SUGGESTED", "STATED", "COMPARABLE", "MEASURED"]),
  provenance: z.string().min(1).max(2000),
  establishedAt: z.coerce.date().optional(),
  evidence: evidenceSchema,
});

const upgradeSchema = recordSchema.extend({
  // The value is optional on an upgrade: better evidence often confirms the
  // number rather than changing it.
  value: z.number().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const model = await getOpportunityModel(user.id, id);
    if (!model) throw new ApiError(404, "Opportunity not found.");

    return jsonOk({
      // The projected view answers "what is each figure, how well is it
      // evidenced, and what blocks capital" in one read.
      figures: model.figures,
      capital: model.capital,
      compatibilityFigures: model.compatibilityFigures,
      // And the raw rows, for anything that needs the stored shape rather than
      // the resolved one.
      recorded: await listEstimates(user.id, id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = recordSchema.parse(await request.json());

    const result = await recordEstimate({
      userId: user.id,
      opportunityId: id,
      figure: body.figure,
      value: body.value,
      basis: body.basis,
      provenance: body.provenance,
      establishedAt: body.establishedAt,
      evidence: body.evidence,
    });

    if (!result.recorded) {
      if (result.reason === "OPPORTUNITY_NOT_FOUND") throw new ApiError(404, result.detail);
      if (result.reason === "EVIDENCE_NOT_FOUND") throw new ApiError(404, result.detail);
      throw new ApiError(422, result.detail);
    }

    return jsonOk({
      estimate: result.estimate,
      capitalEligible: result.capitalEligible,
      note: "An estimate about the future. It is not revenue, and recording it authorizes no spend.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = upgradeSchema.parse(await request.json());

    const result = await upgradeEstimate({
      userId: user.id,
      opportunityId: id,
      figure: body.figure,
      basis: body.basis,
      provenance: body.provenance,
      value: body.value,
      establishedAt: body.establishedAt,
      evidence: body.evidence,
    });

    if (!result.upgraded) {
      if (result.reason === "NOT_RECORDED") throw new ApiError(404, result.detail);
      if (result.reason === "EVIDENCE_NOT_FOUND") throw new ApiError(404, result.detail);
      // 409 rather than 422 for NOT_AN_UPGRADE: the request is well-formed and
      // conflicts with the state of the figure.
      throw new ApiError(result.reason === "NOT_AN_UPGRADE" ? 409 : 422, result.detail);
    }

    return jsonOk({ estimate: result.estimate, from: result.from, to: result.to });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
