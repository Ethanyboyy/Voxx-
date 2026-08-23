import type { NextRequest } from "next/server";
import { updateAutonomySchema } from "@/lib/validation/schemas";
import { getAutonomyMode, setAutonomyMode, setMaxAutonomousSpend } from "@/lib/supervisor/service";
import { db } from "@/lib/db";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const [autonomyMode, row] = await Promise.all([
      getAutonomyMode(user.id),
      db.user.findUniqueOrThrow({ where: { id: user.id }, select: { maxAutonomousSpendUsd: true } }),
    ]);
    return jsonOk({ autonomyMode, maxAutonomousSpendUsd: row.maxAutonomousSpendUsd });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Never widens what the Supervisor may do beyond checkCapability()/the
 * user's own Permission grants — see the AutonomyMode doc comment in
 * schema.prisma. This only changes how conservatively new agents are
 * authorized and what the economic.record_expense tool may spend
 * autonomously (src/lib/economic/policy.ts). */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = updateAutonomySchema.parse(await request.json());
    const [autonomyMode, maxAutonomousSpendUsd] = await Promise.all([
      body.autonomyMode ? setAutonomyMode(user.id, body.autonomyMode) : getAutonomyMode(user.id),
      body.maxAutonomousSpendUsd !== undefined
        ? setMaxAutonomousSpend(user.id, body.maxAutonomousSpendUsd)
        : db.user.findUniqueOrThrow({ where: { id: user.id }, select: { maxAutonomousSpendUsd: true } }).then((r) => r.maxAutonomousSpendUsd),
    ]);
    return jsonOk({ autonomyMode, maxAutonomousSpendUsd });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
