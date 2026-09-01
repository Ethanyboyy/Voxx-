-- Economic hardening: canonical integer cents + a crash-safe tick lifecycle.
--
-- BACKFILL. The two INSERT ... SELECT statements below are hand-edited from the
-- generated migration: Prisma would have left "amountCents" at its DEFAULT 0 for
-- every existing row, which would silently zero the ledger for every canonical
-- calculation (spend ceiling, P&L, policy remaining) while leaving the legacy
-- "amountUsd" column looking correct. CAST(ROUND(amountUsd * 100) AS INTEGER)
-- converts each row exactly once, here, where it can be reviewed -- rather than
-- lazily at read time, where a missed call site would be invisible.
--
-- ROUND before CAST is deliberate: SQLite's CAST truncates toward zero, so
-- CAST(19.99 * 100 AS INTEGER) is 1998, not 1999, because 19.99 has no exact
-- binary representation. That one-cent-per-row drift is precisely the class of
-- error this migration exists to remove.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EconomicExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'USER_RECORDED',
    "occurredAt" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EconomicExpense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EconomicExpense" ("amountUsd", "amountCents", "assetId", "category", "createdAt", "id", "notes", "occurredAt", "provenance") SELECT "amountUsd", CAST(ROUND("amountUsd" * 100) AS INTEGER), "assetId", "category", "createdAt", "id", "notes", "occurredAt", "provenance" FROM "EconomicExpense";
DROP TABLE "EconomicExpense";
ALTER TABLE "new_EconomicExpense" RENAME TO "EconomicExpense";
CREATE INDEX "EconomicExpense_assetId_occurredAt_idx" ON "EconomicExpense"("assetId", "occurredAt");
CREATE INDEX "EconomicExpense_provenance_idx" ON "EconomicExpense"("provenance");
CREATE TABLE "new_EconomicRevenue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'USER_RECORDED',
    "occurredAt" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EconomicRevenue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EconomicRevenue" ("amountUsd", "amountCents", "assetId", "createdAt", "id", "notes", "occurredAt", "provenance", "source") SELECT "amountUsd", CAST(ROUND("amountUsd" * 100) AS INTEGER), "assetId", "createdAt", "id", "notes", "occurredAt", "provenance", "source" FROM "EconomicRevenue";
DROP TABLE "EconomicRevenue";
ALTER TABLE "new_EconomicRevenue" RENAME TO "EconomicRevenue";
CREATE INDEX "EconomicRevenue_assetId_occurredAt_idx" ON "EconomicRevenue"("assetId", "occurredAt");
CREATE TABLE "new_EconomicTick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tickKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "leaseExpiresAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "scaleCount" INTEGER NOT NULL DEFAULT 0,
    "holdCount" INTEGER NOT NULL DEFAULT 0,
    "killCount" INTEGER NOT NULL DEFAULT 0,
    "decisions" TEXT,
    "note" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "EconomicTick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EconomicTick" ("decisions", "evaluatedCount", "finishedAt", "holdCount", "id", "killCount", "note", "scaleCount", "startedAt", "status", "tickKey", "userId") SELECT "decisions", "evaluatedCount", "finishedAt", "holdCount", "id", "killCount", "note", "scaleCount", "startedAt", "status", "tickKey", "userId" FROM "EconomicTick";
DROP TABLE "EconomicTick";
ALTER TABLE "new_EconomicTick" RENAME TO "EconomicTick";
CREATE INDEX "EconomicTick_userId_startedAt_idx" ON "EconomicTick"("userId", "startedAt");
CREATE UNIQUE INDEX "EconomicTick_userId_tickKey_key" ON "EconomicTick"("userId", "tickKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
