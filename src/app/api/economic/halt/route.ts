import { z } from "zod";
import { getHaltState, haltEconomicEngine, resumeEconomicEngine } from "@/lib/economic/halt";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ halt: await getHaltState(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("halt"), reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal("resume") }),
]);

/**
 * Engaging the halt is deliberately NOT capability-gated: it is the user's own
 * emergency stop on their own engine, it only ever reduces what VOX may do,
 * and a stop that can be refused is not a stop. Releasing it is gated by
 * nothing more than being the authenticated owner — the same posture as
 * setting the spend ceiling — but it writes a consequential Event either way.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());
    const halt =
      body.action === "halt"
        ? await haltEconomicEngine(user.id, body.reason)
        : await resumeEconomicEngine(user.id);
    return jsonOk({ halt });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
