-- CreateTable
CREATE TABLE "OpportunityEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "figure" TEXT NOT NULL,
    "valueCents" INTEGER,
    "valueRatio" REAL,
    "valueDays" INTEGER,
    "basis" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "establishedAt" DATETIME NOT NULL,
    "experimentId" TEXT,
    "measurementId" TEXT,
    "researchItemId" TEXT,
    "comparableId" TEXT,
    "previousBasis" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OpportunityEstimate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OpportunityEstimate_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OpportunityEstimate_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OpportunityEstimate_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "ExperimentMeasurement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OpportunityEstimate_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OpportunityEstimate_comparableId_fkey" FOREIGN KEY ("comparableId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OpportunityEstimate_userId_basis_idx" ON "OpportunityEstimate"("userId", "basis");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityEstimate_opportunityId_figure_key" ON "OpportunityEstimate"("opportunityId", "figure");
