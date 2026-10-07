-- CreateTable
CREATE TABLE "OutreachAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "prospect" TEXT NOT NULL,
    "organization" TEXT,
    "channel" TEXT NOT NULL,
    "offer" TEXT,
    "askedPriceCents" INTEGER,
    "outcome" TEXT NOT NULL DEFAULT 'NO_RESPONSE',
    "sentAt" DATETIME NOT NULL,
    "respondedAt" DATETIME,
    "notes" TEXT,
    "paidAt" DATETIME,
    "paidAmountCents" INTEGER,
    "paymentProcessor" TEXT,
    "paymentReference" TEXT,
    "revenueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachAttempt_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachAttempt_revenueId_key" ON "OutreachAttempt"("revenueId");

-- CreateIndex
CREATE INDEX "OutreachAttempt_userId_outcome_idx" ON "OutreachAttempt"("userId", "outcome");

-- CreateIndex
CREATE INDEX "OutreachAttempt_userId_sentAt_idx" ON "OutreachAttempt"("userId", "sentAt");
