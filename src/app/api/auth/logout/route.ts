import { cookies } from "next/headers";
import { logout } from "@/lib/auth/service";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/auth/session";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST() {
  try {
    const user = await requireUser();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) await logout(user.id, token);
    await clearSessionCookie();
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
