import { db } from "@/lib/db";
import { clearSessionCookie } from "@/lib/auth/session";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/**
 * Full account + data deletion. This is the user's own direct, explicit
 * action on their own data (not an autonomous VOX action), so it bypasses
 * the capability-permission system — but it is irreversible, so the client
 * requires a typed confirmation before calling this.
 */
export async function DELETE() {
  try {
    const user = await requireUser();
    await db.user.delete({ where: { id: user.id } });
    await clearSessionCookie();
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
