import { z } from "zod";
import { observeExperimentExecution, recordExternalMeasurement } from "@/lib/economic/evidence";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-D] Produces the experiment's one measurement.
 *
 * Two shapes, and the distinction between them is the point of the endpoint:
 *
 *   `{ }`              VOX observes its own execution's persisted output.
 *   `{ observedValue…}` A PERSON reports a figure from outside VOX.
 *
 * They are kept in one route because they are mutually exclusive by
 * construction — `recordExternalMeasurement()` refuses outright once an
 * execution exists — and separating them would invite a caller to believe both
 * could apply. What must never happen is a human figure being recorded in a way
 * that later reads as VOX's own observation, which is why the manual shape
 * requires `provenance` and writes `source: HUMAN_ENTERED`.
 */
const manualSchema = z.object({
  observedValue: z.number().int().min(0),
  observedTotal: z.number().int().min(0),
  unit: z.string().min(1).max(200),
  provenance: z.string().min(1).max(500),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const raw = await request.json().catch(() => ({}));
    const manual = manualSchema.safeParse(raw);

    if (manual.success) {
      const result = await recordExternalMeasurement({ userId: user.id, experimentId: id, ...manual.data });
      if (!result.recorded) {
        if (result.reason === "NOT_FOUND") throw new ApiError(404, "Experiment not found.");
        throw new ApiError(409, manualRefusalMessage(result.reason));
      }
      return jsonOk({ measurement: result.measurement }, 201);
    }

    const result = await observeExperimentExecution(user.id, id);
    if (!result.observed) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, "Experiment not found.");
      // The unavailable case is deliberately NOT an error status that a client
      // might render as a failure of VOX. It is a successful report that no
      // number came back, and it carries the reason so a surface can say so
      // rather than showing a silence that looks like a zero.
      if (result.reason === "OBSERVATION_UNAVAILABLE") {
        return jsonOk({ observed: false, failure: result.failure, detail: result.detail });
      }
      throw new ApiError(409, observeRefusalMessage(result.reason));
    }
    return jsonOk({ measurement: result.measurement }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function manualRefusalMessage(reason: string): string {
  switch (reason) {
    case "ALREADY_MEASURED":
      return "This experiment already has a measurement.";
    case "EXECUTION_EXISTS":
      return "VOX executed this experiment, so a typed figure would read as VOX's own observation while resting on nobody's. Observe the execution instead, or leave the absence visible.";
    case "INVALID_VALUE":
      return "A measurement needs non-negative whole numbers, a unit, and a stated source.";
    default:
      return "The measurement could not be recorded.";
  }
}

function observeRefusalMessage(reason: string): string {
  switch (reason) {
    case "ALREADY_MEASURED":
      return "This experiment already has a measurement.";
    case "NOT_DISPATCHED":
      return "This experiment has no execution to observe.";
    case "EXECUTION_NOT_COMPLETED":
      return "The execution has not completed. There is nothing to read yet.";
    case "EXECUTION_IN_DOUBT":
      return "A step of this execution began and its end was never recorded. What happened is unknown, and an unknown must not be resolved by assumption.";
    case "NO_OBSERVABLE_OUTPUT":
      return "The execution completed without a completed step for this rule's tool.";
    case "UNREADABLE_OUTPUT":
      return "The execution's stored output is not the shape this rule reads.";
    case "UNKNOWN_OBSERVATION_RULE":
      return "This experiment's observation rule is not in the frozen registry.";
    default:
      return "The execution could not be observed.";
  }
}
