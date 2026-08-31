import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";
import { getRequestProgress } from "@/lib/capabilities/progress";

/**
 * Live state of one driven request.
 *
 * Scoped to the caller in the query itself — both the run and the capability
 * runs are looked up with `userId`, so another user's traceId returns an empty
 * trace rather than someone else's work. Guessing a traceId therefore reveals
 * nothing.
 */
const querySchema = z.object({
  traceId: z.string().min(1).max(64),
  runId: z.string().max(64).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = querySchema.safeParse({
      traceId: request.nextUrl.searchParams.get("traceId") ?? undefined,
      runId: request.nextUrl.searchParams.get("runId") ?? undefined,
    });
    if (!parsed.success) throw new ApiError(400, "A traceId is required.");

    const progress = await getRequestProgress(user.id, parsed.data.traceId, parsed.data.runId);
    return jsonOk({ progress });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
