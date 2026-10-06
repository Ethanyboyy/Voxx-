-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "brief" TEXT NOT NULL,
    "focus" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "refusalReason" TEXT,
    "refusalDetail" TEXT,
    "proposedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscoveryRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoveryRun_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "category" TEXT,
    "rationale" TEXT,
    "uncertainty" TEXT,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "proposalDigest" TEXT NOT NULL,
    "rawProposal" TEXT NOT NULL,
    "opportunityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoveryCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoveryCandidate_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_userId_startedAt_idx" ON "DiscoveryRun"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_opportunityId_key" ON "DiscoveryCandidate"("opportunityId");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_userId_status_idx" ON "DiscoveryCandidate"("userId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_userId_proposalDigest_idx" ON "DiscoveryCandidate"("userId", "proposalDigest");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_runId_proposalDigest_key" ON "DiscoveryCandidate"("runId", "proposalDigest");
