import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

export async function createTestUser(email = `test-${randomUUID()}@example.com`) {
  const passwordHash = await hashPassword("correcthorsebattery1");
  return db.user.create({ data: { email, passwordHash } });
}

/**
 * Writes a ledger row directly, with `amountCents` correct.
 *
 * Tests need this because some fixtures must produce rows the service layer
 * deliberately refuses to create — a REALIZED row above all (invariant I1: no
 * ordinary write path may assert external confirmation). Going through
 * `db.economicRevenue.create` by hand is how those fixtures silently ended up
 * with `amountCents: 0` and measured as nothing; this helper keeps the two
 * representations in step the same way the service does.
 */
export async function seedLedgerEntry(
  side: "revenue" | "expense",
  input: {
    assetId: string;
    amountUsd: number;
    occurredAt: Date;
    provenance?: "REALIZED" | "USER_RECORDED" | "SIMULATED";
    source?: string;
    category?: string;
  }
) {
  const data = {
    assetId: input.assetId,
    amountUsd: input.amountUsd,
    amountCents: Math.round(input.amountUsd * 100),
    provenance: input.provenance ?? ("USER_RECORDED" as const),
    occurredAt: input.occurredAt,
  };
  return side === "revenue"
    ? db.economicRevenue.create({ data: { ...data, source: input.source } })
    : db.economicExpense.create({ data: { ...data, category: input.category } });
}
