import { z } from "zod";
import {
  declareObservationContract,
  EXTERNAL_ORDER_COUNT_RULE,
  EXTERNAL_ORDER_VALUE_RULE,
} from "@/lib/economic/externalObservation";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P6-G] DECLARING THE FROZEN OBSERVATION WINDOW.
 *
 * This is the one piece of the live path that had no door. `declareObservationContract()`
 * has existed since P5-E and took a subject since P6-F, and until now its only
 * callers were test files — so a window could be frozen in a spec and nowhere
 * else, and an operator conducting a real experiment could not declare the
 * question through the application at all. That is the gap P6-G closes, and it
 * is the whole of what P6-G adds to the write path.
 *
 * IT GRANTS NOTHING AND EXECUTES NOTHING. The function underneath writes the
 * experiment's own contract columns and refuses `ALREADY_DISPATCHED` once an
 * execution identity exists, which is the freeze: after dispatch, changing the
 * window or the store is choosing the question with the answer in view. This
 * route adds no authority of its own — it is an HTTP surface over a declaration
 * that was already safe to make.
 *
 * THE RULE IS A CLOSED SET, not free text. `openDeclaredWindow()` matches the
 * stored rule against the specific rule the observer expects, so a typo here
 * would produce a contract no observation can ever satisfy — a window that
 * looks declared and is permanently unobservable. Validating against the two
 * real rules turns that into a 400 at declare time.
 *
 * WHAT IS NOT HERE: declaring the intervention (`POST /api/commerce/actions`),
 * executing it (the `commerce.create_discount_code` tool through the executor),
 * confirming the subject exists (`POST .../intervention`), and reading the
 * store (the `economic.observe_order_value` tool). All four already existed and
 * all four stay where they are.
 */
const bodySchema = z.object({
  rule: z.enum([EXTERNAL_ORDER_COUNT_RULE, EXTERNAL_ORDER_VALUE_RULE]),
  /** The shop domain. Public, stored in the clear. */
  externalScope: z.string().min(3).max(80),
  /** INCLUSIVE lower bound, ISO-8601. */
  windowStart: z.string(),
  windowMinutes: z.number().int().min(1).max(60 * 24 * 90),
  /**
   * The discount code to attribute to, when the window measures an
   * intervention rather than the whole store. It MUST be the code of this
   * experiment's own declared `CommercialAction`; anything else is refused
   * `SUBJECT_MISMATCH` by the service, which is what makes attribution an
   * experiment binding rather than a free-text filter.
   */
  observationSubject: z.string().min(3).max(32).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json());

    const windowStart = new Date(body.windowStart);
    if (Number.isNaN(windowStart.getTime())) {
      throw new ApiError(400, "windowStart is not a valid ISO-8601 instant.");
    }

    const result = await declareObservationContract({
      userId: user.id,
      experimentId: id,
      rule: body.rule,
      externalScope: body.externalScope,
      windowStart,
      windowMinutes: body.windowMinutes,
      observationSubject: body.observationSubject,
    });

    if (!result.declared) {
      if (result.reason === "NOT_FOUND") throw new ApiError(404, "Experiment not found.");
      // 409 for the freeze, 400 for malformed terms. The distinction matters:
      // ALREADY_DISPATCHED is not something a caller fixes by resubmitting.
      throw new ApiError(
        result.reason === "ALREADY_DISPATCHED" ? 409 : 400,
        result.reason === "ALREADY_DISPATCHED"
          ? "This experiment has already been dispatched. The observation contract is frozen — declaring the question after the run is what the freeze prevents."
          : result.reason === "SUBJECT_MISMATCH"
            ? "The subject is not the code this experiment's own intervention creates. Declare the intervention first, and name its code."
            : result.reason === "INVALID_WINDOW"
              ? "The window is not resolvable."
              : "The external scope is empty."
      );
    }

    return jsonOk({
      declared: true,
      digest: result.digest,
      windowStart: result.windowStart.toISOString(),
      windowEnd: result.windowEnd.toISOString(),
      subject: result.subject,
      note:
        result.subject === null
          ? "This window measures every order the store takes in it, not the effect of any one intervention."
          : "This window attributes only to orders carrying this code. Attribution over a window is not causation.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
