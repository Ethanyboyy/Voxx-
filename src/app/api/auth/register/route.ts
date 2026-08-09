import type { NextRequest } from "next/server";
import { registerSchema } from "@/lib/validation/schemas";
import { registerFirstUser, AuthError } from "@/lib/auth/service";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const body = registerSchema.parse(await request.json());
    const user = await registerFirstUser(body.email, body.password, body.name).catch((error) => {
      if (error instanceof AuthError) throw new ApiError(409, error.message);
      throw error;
    });

    const session = await createSession(user.id, request.headers.get("user-agent"));
    await setSessionCookie(session.token, session.expiresAt);

    return jsonOk({ id: user.id, email: user.email, name: user.name }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
