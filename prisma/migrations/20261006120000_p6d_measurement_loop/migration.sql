-- AlterTable
ALTER TABLE "ExperimentMeasurement" ADD COLUMN "limitations" TEXT;

-- AlterTable
ALTER TABLE "ProfitPrediction" ADD COLUMN "predictedInputs" TEXT;

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
    "measurementId" TEXT,
    CONSTRAINT "EconomicExpense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EconomicExpense_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "ExperimentMeasurement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EconomicExpense" ("amountCents", "amountUsd", "assetId", "category", "createdAt", "id", "notes", "occurredAt", "provenance") SELECT "amountCents", "amountUsd", "assetId", "category", "createdAt", "id", "notes", "occurredAt", "provenance" FROM "EconomicExpense";
DROP TABLE "EconomicExpense";
ALTER TABLE "new_EconomicExpense" RENAME TO "EconomicExpense";
CREATE UNIQUE INDEX "EconomicExpense_measurementId_key" ON "EconomicExpense"("measurementId");
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
    "measurementId" TEXT,
    CONSTRAINT "EconomicRevenue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EconomicRevenue_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "ExperimentMeasurement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EconomicRevenue" ("amountCents", "amountUsd", "assetId", "createdAt", "id", "notes", "occurredAt", "provenance", "source") SELECT "amountCents", "amountUsd", "assetId", "createdAt", "id", "notes", "occurredAt", "provenance", "source" FROM "EconomicRevenue";
DROP TABLE "EconomicRevenue";
ALTER TABLE "new_EconomicRevenue" RENAME TO "EconomicRevenue";
CREATE UNIQUE INDEX "EconomicRevenue_measurementId_key" ON "EconomicRevenue"("measurementId");
CREATE INDEX "EconomicRevenue_assetId_occurredAt_idx" ON "EconomicRevenue"("assetId", "occurredAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
