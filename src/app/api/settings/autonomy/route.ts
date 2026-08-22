import type { NextRequest } from "next/server";
import { updateAutonomySchema } from "@/lib/validation/schemas";
import { getAutonomyMode, setAutonomyMode } from "@/lib/supervisor/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const autonomyMode = await getAutonomyMode(user.id);
    return jsonOk({ autonomyMode });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Never widens what the Supervisor may do beyond checkCapability()/the
 * user's own Permission grants — see the AutonomyMode doc comment in
 * schema.prisma. This only changes how conservatively new agents are authorized. */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = updateAutonomySchema.parse(await request.json());
    const autonomyMode = await setAutonomyMode(user.id, body.autonomyMode);
    return jsonOk({ autonomyMode });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
