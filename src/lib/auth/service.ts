import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySessionByToken } from "@/lib/auth/session";
import { recordEvent } from "@/lib/observability/events";
import { seedLabForUser } from "@/lib/lab/seedForUser";
import { logger } from "@/lib/observability/logger";

export class AuthError extends Error {}

/** VOX is single-user in Phase 1: registration is only allowed while no account exists. */
export async function hasAnyUser(): Promise<boolean> {
  const count = await db.user.count();
  return count > 0;
}

/**
 * The count-then-create is wrapped in one transaction rather than two
 * separate awaited calls — SQLite serializes writers, so two concurrent
 * registration requests can no longer both observe "no user yet" and both
 * create an account. The plain hasAnyUser() check above remains fine for
 * read-only "is setup needed" UI decisions.
 */
export async function registerFirstUser(email: string, password: string, name?: string) {
  if (password.length < 10) {
    throw new AuthError("Password must be at least 10 characters.");
  }

  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    const existing = await tx.user.count();
    if (existing > 0) {
      throw new AuthError("An account already exists. VOX is single-user in Phase 1.");
    }
    return tx.user.create({
      data: { email: email.toLowerCase().trim(), passwordHash, name },
    });
  });
  await recordEvent({ userId: user.id, type: "auth.user_registered" });

  // Best-effort: populate the new account's Spider-Man Laboratory starter
  // catalog (fictional suit/gadget designs — see prisma/seed.ts). Never
  // blocks account creation on failure; logged so a partial seed is visible
  // rather than silently missing.
  try {
    await seedLabForUser(user.id);
  } catch (error) {
    logger.error("lab.seed_for_user_failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return user;
}

export async function login(email: string, password: string, userAgent?: string | null) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new AuthError("Invalid email or password.");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new AuthError("Invalid email or password.");

  const session = await createSession(user.id, userAgent);
  await recordEvent({ userId: user.id, type: "auth.login" });
  return { user, ...session };
}

export async function logout(userId: string, token: string) {
  await destroySessionByToken(token);
  await recordEvent({ userId, type: "auth.logout" });
}
