// The final economic spend boundary, enforced atomically.
//
// WHAT WAS WRONG. `evaluateSpendPolicy()` compared ONE amount against the
// ceiling — it never looked at cumulative spend at all. With a $100 ceiling, an
// agent could spend $60, then $60, then $60, indefinitely: each request was
// individually "within the $100 limit", and nothing anywhere added them up. The
// ceiling was not racy; it was not a ceiling. `recordOpportunitySpend()`, the
// function that actually writes the row, checked nothing but the halt.
//
// THE FIX, AND WHY IT IS SHAPED THIS WAY. The check and the write are ONE
// statement. A read-then-write pair — read remaining, decide, insert — has a
// window between the read and the insert no matter how tight, and two requests
// inside that window both see the same remaining budget and both proceed. That
// is unfixable at the application layer without a lock, so the guard is pushed
// into the database:
//
//   INSERT INTO EconomicExpense (...)
//   SELECT <the new row>
//   WHERE <not halted> AND <existing policy spend + this amount <= ceiling>
//
// SQLite evaluates the subqueries and performs the insert inside a single
// implicit write transaction, holding the write lock throughout. A second
// connection either waits and then re-evaluates its WHERE against the committed
// first row, or gets SQLITE_BUSY and retries. Either way it sees the other
// spend. There is no window, because there is no gap between deciding and
// writing.
//
// The guard reads the LEDGER, not a cached counter. A counter would be a second
// source of truth that can drift from the rows it summarizes; here the rows are
// the only source of truth, so an over-spend is impossible rather than merely
// unlikely.
//
// THE HALT IS INSIDE THE SAME STATEMENT for the same reason: a halt engaged
// concurrently with a spend must not land in the gap between "checked halt" and
// "wrote row".
//
// SCOPE. This is the AUTONOMOUS spend path — what an agent reaches through the
// economic.record_expense tool. Direct user CRUD (`addEconomicExpense`) does not
// pass through here on purpose: a human recording an expense they already made
// in the world is recording history, and refusing to record it would make the
// ledger wrong without preventing the spend. The ceiling governs what VOX may
// spend on its own initiative, which is exactly this path.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { getPolicySpendPosition, type PolicySpendPosition } from "@/lib/economic/accounting";
import { normalizeAmount, formatCents } from "@/lib/economic/money";
import type { EconomicExpense } from "@/generated/prisma/client";

/** Why a spend was refused. Machine-readable so callers never parse prose. */
export type SpendRefusalCode = "HALTED" | "CEILING_EXCEEDED" | "ASSET_NOT_FOUND";

export class SpendRefusedError extends Error {
  constructor(
    readonly code: SpendRefusalCode,
    message: string,
    readonly position: PolicySpendPosition | null = null
  ) {
    super(message);
    this.name = "SpendRefusedError";
  }
}

export interface RecordPolicySpendInput {
  assetId: string;
  amountUsd: number;
  category?: string;
  notes?: string;
  occurredAt?: Date;
}

/**
 * Records an autonomous spend, or refuses it. Never both, never partially.
 *
 * The amount is validated first (see money.ts): a NaN or an Infinity must never
 * reach the SQL guard, because `NaN <= ceiling` is false — it would be refused,
 * which looks safe — but `Infinity` inserted into a ledger would make every
 * later sum Infinity and every later ceiling comparison false, silently
 * bricking the engine. Rejecting at the type boundary is cheaper than reasoning
 * about which non-finite values happen to fail safe.
 */
export async function recordPolicySpend(userId: string, input: RecordPolicySpendInput): Promise<EconomicExpense> {
  const { cents, usd } = normalizeAmount(input.amountUsd, "amountUsd");

  // Ownership is checked before the guard because the guard's WHERE cannot
  // distinguish "asset belongs to someone else" from "over ceiling", and those
  // need different errors. This is not a security gap: the guard's budget
  // subquery is scoped to `userId`, so writing to another user's asset could
  // never consume the attacker's own budget — it would fail this check first,
  // and even if it did not, the row would land where its owner can see it.
  const asset = await db.economicAsset.findFirst({ where: { id: input.assetId, userId }, select: { id: true } });
  if (!asset) {
    throw new SpendRefusedError("ASSET_NOT_FOUND", `Economic asset ${input.assetId} was not found for this user.`);
  }

  const id = randomUUID();
  const now = new Date();
  const occurredAt = input.occurredAt ?? now;

  // THE ATOMIC GUARD. Everything that can refuse this spend is evaluated inside
  // the same statement that writes it.
  //
  // `provenance` is hardcoded to USER_RECORDED rather than taken from the
  // caller: an autonomous spend is real money leaving, so it must consume real
  // budget. Letting a caller pass SIMULATED here would be a one-parameter
  // bypass of the entire ceiling (invariant I2). REALIZED is likewise
  // unreachable — nothing may assert external confirmation (invariant I1).
  const inserted = await db.$executeRaw`
    INSERT INTO "EconomicExpense"
      ("id", "assetId", "amountUsd", "amountCents", "category", "provenance", "occurredAt", "notes", "createdAt")
    SELECT
      ${id}, ${input.assetId}, ${usd}, ${cents}, ${input.category ?? null},
      'USER_RECORDED', ${occurredAt}, ${input.notes ?? null}, ${now}
    WHERE
      (SELECT COUNT(*) FROM "User" u WHERE u."id" = ${userId} AND u."economicHaltedAt" IS NULL) = 1
      AND (
        ${cents} + COALESCE((
          SELECT SUM(e."amountCents")
          FROM "EconomicExpense" e
          JOIN "EconomicAsset" a ON a."id" = e."assetId"
          WHERE a."userId" = ${userId}
            AND e."provenance" IN ('REALIZED', 'USER_RECORDED')
        ), 0)
      ) <= (SELECT CAST(u."maxAutonomousSpendUsd" * 100 AS INTEGER) FROM "User" u WHERE u."id" = ${userId})
  `;

  if (inserted === 0) {
    // The guard refused. Re-read to say WHICH condition failed — this read is
    // outside the transaction and therefore advisory, used only to phrase the
    // error. The refusal itself already happened, atomically, above.
    const position = await getPolicySpendPosition(userId);
    if (position.halted) {
      throw new SpendRefusedError(
        "HALTED",
        `The global economic halt is engaged${position.haltReason ? `: ${position.haltReason}` : ""}. No autonomous spend may occur until it is released.`,
        position
      );
    }
    throw new SpendRefusedError(
      "CEILING_EXCEEDED",
      `${formatCents(cents)} would take autonomous spend to ${formatCents(position.spentCents + cents)}, above the ceiling of ${formatCents(position.ceilingCents)} (${formatCents(position.remainingCents)} remaining).`,
      position
    );
  }

  const expense = await db.economicExpense.findUniqueOrThrow({ where: { id } });

  await recordEvent({
    userId,
    type: "economic_asset.expense_logged",
    subjectType: "EconomicAsset",
    subjectId: input.assetId,
    consequential: true,
    payload: { amountUsd: expense.amountUsd, amountCents: expense.amountCents, autonomous: true },
  });

  return expense;
}
