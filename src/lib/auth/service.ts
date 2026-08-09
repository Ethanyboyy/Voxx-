import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySessionByToken } from "@/lib/auth/session";
import { recordEvent } from "@/lib/observability/events";

export class AuthError extends Error {}

/** VOX is single-user in Phase 1: registration is only allowed while no account exists. */
export async function hasAnyUser(): Promise<boolean> {
  const count = await db.user.count();
  return count > 0;
}

export async function registerFirstUser(email: string, password: string, name?: string) {
  if (await hasAnyUser()) {
    throw new AuthError("An account already exists. VOX is single-user in Phase 1.");
  }
  if (password.length < 10) {
    throw new AuthError("Password must be at least 10 characters.");
  }

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: { email: email.toLowerCase().trim(), passwordHash, name },
  });
  await recordEvent({ userId: user.id, type: "auth.user_registered" });
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
