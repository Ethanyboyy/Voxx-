import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

export const SESSION_COOKIE = "vox_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  const secret = process.env.VOX_SESSION_SECRET;
  if (!secret) {
    throw new Error("VOX_SESSION_SECRET is not set. Add it to .env.");
  }
  return createHash("sha256").update(token).update(secret).digest("hex");
}

/** Creates a DB-backed session row and returns the raw token to hand to the client as a cookie. */
export async function createSession(
  userId: string,
  userAgent?: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.session.create({
    data: { userId, tokenHash, userAgent: userAgent ?? null, expiresAt },
  });

  return { token, expiresAt };
}

export async function getUserForToken(token: string): Promise<User | null> {
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function destroySessionByToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db.session.deleteMany({ where: { tokenHash } });
}

/** Reads the session cookie (Route Handlers / Server Components) and resolves the current user, if any. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserForToken(token);
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
