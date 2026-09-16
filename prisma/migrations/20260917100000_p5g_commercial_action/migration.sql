-- CreateTable
CREATE TABLE "CommercialAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "experimentId" TEXT,
    "kind" TEXT NOT NULL,
    "externalScope" TEXT NOT NULL,
    "parameters" TEXT NOT NULL,
    "contractDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "executionRunId" TEXT,
    "executionStepId" TEXT,
    "submittedAt" DATETIME,
    "externalId" TEXT,
    "responseDigest" TEXT,
    "failureCode" TEXT,
    "failureDetail" TEXT,
    "verifiedAt" DATETIME,
    "verifiedExists" BOOLEAN,
    "verifiedMatches" BOOLEAN,
    "verifiedDetail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommercialAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommercialAction_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAction_experimentId_key" ON "CommercialAction"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAction_executionRunId_key" ON "CommercialAction"("executionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAction_executionStepId_key" ON "CommercialAction"("executionStepId");

-- CreateIndex
CREATE INDEX "CommercialAction_userId_status_idx" ON "CommercialAction"("userId", "status");
