-- CreateTable
CREATE TABLE "ApprovalGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "argumentsHash" TEXT NOT NULL,
    "classificationHash" TEXT NOT NULL,
    "policyDecision" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "capability" TEXT NOT NULL,
    "requiredLevel" TEXT NOT NULL,
    "amplification" INTEGER NOT NULL DEFAULT 1,
    "trustLabels" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    CONSTRAINT "ApprovalGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ApprovalGrant_userId_registry_actionId_idx" ON "ApprovalGrant"("userId", "registry", "actionId");

-- CreateIndex
CREATE INDEX "ApprovalGrant_userId_consumedAt_idx" ON "ApprovalGrant"("userId", "consumedAt");
