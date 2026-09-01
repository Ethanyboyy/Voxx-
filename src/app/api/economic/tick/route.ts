import { listEconomicTicks, runEconomicTick } from "@/lib/economic/scheduler";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ ticks: await listEconomicTicks(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Runs one tick of the economic control loop.
 *
 * Safe to POST repeatedly — the tick is bucketed and idempotent, so a retried
 * request, a double-fired cron or two concurrent callers all produce the same
 * single tick. A response with `performed: false` means this bucket was
 * already evaluated, not that anything failed.
 *
 * There is no cron in VOX yet; this route is how the loop is driven today,
 * which keeps the trigger visible rather than hidden in a background timer
 * nobody can inspect.
 */
export async function POST() {
  try {
    const user = await requireUser();
    return jsonOk({ tick: await runEconomicTick(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
