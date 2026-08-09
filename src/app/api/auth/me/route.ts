import { getCurrentUser } from "@/lib/auth/session";
import { hasAnyUser } from "@/lib/auth/service";
import { jsonOk, apiErrorResponse } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonOk({ user: null, setupRequired: !(await hasAnyUser()) });
    }
    return jsonOk({ user: { id: user.id, email: user.email, name: user.name }, setupRequired: false });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
