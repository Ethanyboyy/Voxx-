import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, getUserForToken, destroySessionByToken } from "@/lib/auth/session";
import { registerFirstUser, login, AuthError, hasAnyUser } from "@/lib/auth/service";
import { createTestUser } from "./helpers";

describe("password hashing", () => {
  it("hashes a password and verifies it, rejecting the wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("sessions", () => {
  it("creates a session and resolves the owning user from its token", async () => {
    const user = await createTestUser();
    const { token, expiresAt } = await createSession(user.id, "vitest");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const resolved = await getUserForToken(token);
    expect(resolved?.id).toBe(user.id);
  });

  it("returns null for an unknown token", async () => {
    expect(await getUserForToken("not-a-real-token")).toBeNull();
  });

  it("expired sessions no longer resolve a user", async () => {
    const user = await createTestUser();
    const { token } = await createSession(user.id);
    const session = await db.session.findFirstOrThrow({ where: { user: { id: user.id } } });
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await getUserForToken(token)).toBeNull();
  });

  it("destroying a session invalidates its token", async () => {
    const user = await createTestUser();
    const { token } = await createSession(user.id);
    await destroySessionByToken(token);
    expect(await getUserForToken(token)).toBeNull();
  });
});

describe("single-user registration boundary", () => {
  it("allows exactly one registration, then refuses further registrations", async () => {
    // Deterministic regardless of other test files' fixtures/order.
    await db.session.deleteMany({});
    await db.user.deleteMany({});
    expect(await hasAnyUser()).toBe(false);

    const user = await registerFirstUser("owner@example.com", "a-long-enough-password");
    expect(user.email).toBe("owner@example.com");
    expect(await hasAnyUser()).toBe(true);

    await expect(registerFirstUser("intruder@example.com", "a-long-enough-password")).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it("rejects passwords under 10 characters", async () => {
    await db.session.deleteMany({});
    await db.user.deleteMany({});
    await expect(registerFirstUser("short@example.com", "short1")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("login", () => {
  it("succeeds with correct credentials and creates a session", async () => {
    await db.session.deleteMany({});
    await db.user.deleteMany({});
    await registerFirstUser("login-test@example.com", "a-long-enough-password");

    const { user, token } = await login("login-test@example.com", "a-long-enough-password");
    expect(user.email).toBe("login-test@example.com");
    expect(await getUserForToken(token)).not.toBeNull();
  });

  it("fails with the wrong password without revealing whether the account exists", async () => {
    await expect(login("login-test@example.com", "wrong-password")).rejects.toBeInstanceOf(AuthError);
  });

  it("fails for an email that doesn't exist, with the same generic error", async () => {
    await expect(login("nobody@example.com", "whatever-password")).rejects.toThrow("Invalid email or password.");
  });
});
