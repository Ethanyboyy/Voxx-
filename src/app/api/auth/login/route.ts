import type { NextRequest } from "next/server";
import { loginSchema } from "@/lib/validation/schemas";
import { login, AuthError } from "@/lib/auth/service";
import { setSessionCookie } from "@/lib/auth/session";
import { apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const body = loginSchema.parse(await request.json());
    const { user, token, expiresAt } = await login(
      body.email,
      body.password,
      request.headers.get("user-agent")
    ).catch((error) => {
      if (error instanceof AuthError) throw new ApiError(401, error.message);
      throw error;
    });

    await setSessionCookie(token, expiresAt);
    return jsonOk({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
