import { z } from "zod";
import { LEDGER_CURRENCY, LEDGER_SCALE, recordOperatorOutcome } from "@/lib/economic/measurementLoop";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-D] THE OPERATOR ENTERS WHAT ACTUALLY HAPPENED.
 *
 * The one path by which a figure becomes MEASURED without VOX having observed
 * it externally, and everything about this route is shaped so the distinction
 * survives: the measurement is written `HUMAN_ENTERED`, the ledger rows are
 * `USER_RECORDED`, the caveats come back in the response, and `provenance` is
 * required because a figure about to become MEASURED cannot have an unstated
 * source.
 *
 * WHAT CANNOT MASQUERADE AS AN OBSERVATION HERE. There is no field for a model
 * to fill: no `basis`, no `confidence`, no `reasoning`, no `externalProvider`,
 * no `responseDigest`. The schema is `.strict()`, so a request carrying any of
 * them is rejected rather than quietly trimmed — a caller cannot dress an
 * operator entry up as a provider response.
 */

const bodySchema = z
  .object({
    /** How many units were summed — orders, signups, sales. */
    observedValue: z.number().int().min(0),
    /** How many were available to sum. Never fewer than `observedValue`. */
    observedTotal: z.number().int().min(0),
    unit: z.string().min(1).max(40),
    /**
     * The observed money in minor units. ZERO IS VALID and is a real result —
     * `.min(0)`, not `.positive()`.
     */
    amountMinor: z.number().int().min(0),
    amountScale: z.literal(LEDGER_SCALE),
    amountCurrency: z.literal(LEDGER_CURRENCY),
    /** What was actually spent, in minor units. Zero writes no ledger row. */
    spentMinor: z.number().int().min(0).optional(),
    provenance: z.string().min(1).max(2000),
    limitations: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((body) => body.observedTotal >= body.observedValue, {
    message: "observedTotal cannot be fewer than observedValue — a sum cannot cover more than was available.",
    path: ["observedTotal"],
  });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());

    const result = await recordOperatorOutcome({
      userId: user.id,
      experimentId: id,
      observedValue: body.observedValue,
      observedTotal: body.observedTotal,
      unit: body.unit,
      amountMinor: body.amountMinor,
      amountScale: body.amountScale,
      currency: body.amountCurrency,
      spentMinor: body.spentMinor,
      provenance: body.provenance,
      limitations: body.limitations,
    });

    if (!result.recorded) {
      if (result.reason === "EXPERIMENT_NOT_FOUND") throw new ApiError(404, result.detail);
      // 409 where the refusal is about the experiment's state — a measurement
      // already recorded, no prediction frozen, VOX's own execution in the way.
      const conflict =
        result.reason === "ALREADY_MEASURED" ||
        result.reason === "NO_PREDICTION" ||
        result.reason === "PREDICTION_NOT_EARLIER" ||
        result.reason === "EXECUTION_EXISTS";
      throw new ApiError(conflict ? 409 : 422, result.detail);
    }

    return jsonOk({
      measurement: {
        id: result.measurement.id,
        source: result.measurement.source,
        digest: result.measurement.digest,
        observedAt: result.measurement.observedAt,
      },
      promoted: result.promoted,
      settled: {
        revenueCents: result.revenue?.amountCents ?? 0,
        expenseCents: result.expense?.amountCents ?? 0,
        provenance: "USER_RECORDED",
      },
      reconciliation: result.reconciliation,
      calibration: {
        totalResolved: result.calibration.totalResolved,
        insufficientSample: result.calibration.insufficientSample,
        overallFactor: result.calibration.overallFactor,
      },
      // Returned in the body, not logged. The limitations are part of the
      // finding rather than a footnote to it.
      caveats: result.caveats,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
