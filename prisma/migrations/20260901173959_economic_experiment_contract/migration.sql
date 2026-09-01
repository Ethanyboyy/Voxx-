-- AlterTable
ALTER TABLE "User" ADD COLUMN "economicHaltReason" TEXT;
ALTER TABLE "User" ADD COLUMN "economicHaltedAt" DATETIME;

-- CreateTable
CREATE TABLE "EconomicTick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tickKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EconomicExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "category" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'USER_RECORDED',
    "occurredAt" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EconomicExpense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EconomicExpense" ("amountUsd", "assetId", "category", "createdAt", "id", "notes", "occurredAt") SELECT "amountUsd", "assetId", "category", "createdAt", "id", "notes", "occurredAt" FROM "EconomicExpense";
DROP TABLE "EconomicExpense";
ALTER TABLE "new_EconomicExpense" RENAME TO "EconomicExpense";
CREATE INDEX "EconomicExpense_assetId_occurredAt_idx" ON "EconomicExpense"("assetId", "occurredAt");
CREATE TABLE "new_EconomicRevenue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "source" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'USER_RECORDED',
    "occurredAt" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EconomicRevenue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EconomicAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EconomicRevenue" ("amountUsd", "assetId", "createdAt", "id", "notes", "occurredAt", "source") SELECT "amountUsd", "assetId", "createdAt", "id", "notes", "occurredAt", "source" FROM "EconomicRevenue";
DROP TABLE "EconomicRevenue";
ALTER TABLE "new_EconomicRevenue" RENAME TO "EconomicRevenue";
CREATE INDEX "EconomicRevenue_assetId_occurredAt_idx" ON "EconomicRevenue"("assetId", "occurredAt");
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "ideaId" TEXT,
    "hypothesis" TEXT NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "opportunityId" TEXT,
    "economicAssetId" TEXT,
    "requiredCapitalUsd" REAL,
    "maxLossUsd" REAL,
    "successMetric" TEXT,
    "failureMetric" TEXT,
    "deadlineAt" DATETIME,
    "scaleCriteria" TEXT,
    "scaleAtNetUsd" REAL,
    "killCriteria" TEXT,
    "killAtNetUsd" REAL,
    "expectedReturnUsd" REAL,
    "expectedNetProfitUsd" REAL,
    "requiredCapabilities" TEXT,
    "executionStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "lastDecision" TEXT,
    "lastDecisionReason" TEXT,
    "lastDecisionAt" DATETIME,
    CONSTRAINT "Experiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_economicAssetId_fkey" FOREIGN KEY ("economicAssetId") REFERENCES "EconomicAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Experiment" ("createdAt", "endedAt", "hypothesis", "id", "ideaId", "method", "projectId", "startedAt", "status", "updatedAt", "userId") SELECT "createdAt", "endedAt", "hypothesis", "id", "ideaId", "method", "projectId", "startedAt", "status", "updatedAt", "userId" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
CREATE INDEX "Experiment_userId_executionStatus_idx" ON "Experiment"("userId", "executionStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EconomicTick_userId_startedAt_idx" ON "EconomicTick"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicTick_userId_tickKey_key" ON "EconomicTick"("userId", "tickKey");
