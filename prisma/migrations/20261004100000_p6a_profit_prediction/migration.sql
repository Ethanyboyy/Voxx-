-- CreateTable
CREATE TABLE "ProfitPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "experimentId" TEXT,
    "predictedNetCents" INTEGER NOT NULL,
    "predictedProbability" REAL NOT NULL,
    "predictedBasis" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "observedNetCents" INTEGER,
    "observedAt" DATETIME,
    "outcomeSource" TEXT,
    "unresolvedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfitPrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfitPrediction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfitPrediction_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfitPrediction_experimentId_key" ON "ProfitPrediction"("experimentId");

-- CreateIndex
CREATE INDEX "ProfitPrediction_userId_opportunityId_idx" ON "ProfitPrediction"("userId", "opportunityId");

-- CreateIndex
CREATE INDEX "ProfitPrediction_userId_predictedBasis_idx" ON "ProfitPrediction"("userId", "predictedBasis");
