import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

export async function createTestUser(email = `test-${randomUUID()}@example.com`) {
  const passwordHash = await hashPassword("correcthorsebattery1");
  return db.user.create({ data: { email, passwordHash } });
}
