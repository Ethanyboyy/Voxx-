import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/permissions/service";
import { logger } from "@/lib/observability/logger";
import type { User } from "@/generated/prisma/client";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Every protected route handler must call this first — the auth boundary for the whole API surface. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(401, "Not authenticated.");
  }
  return user;
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Central error → HTTP response mapping. Never leaks stack traces or
 * internal error text for unrecognized errors — logs the detail server-side
 * and returns a generic message instead.
 */
export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PermissionDeniedError) {
    return Response.json(
      { error: error.message, capability: error.capability, requiredLevel: error.requiredLevel },
      { status: 403 }
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid request.", issues: error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 }
    );
  }

  logger.error("api.unhandled_error", {
    message: error instanceof Error ? error.message : String(error),
  });
  return Response.json({ error: "Internal server error." }, { status: 500 });
}
