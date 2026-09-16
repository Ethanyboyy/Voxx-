-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN "executionRunId" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "lastObservationAttemptAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "lastObservationFailure" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "observationRule" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "outcomeEvidenceBasis" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "outcomeMeasurementDigest" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "outcomeMeasurementId" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "outcomeNote" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "outcomeRecordedAt" DATETIME;

-- CreateTable
CREATE TABLE "ExperimentMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "agentRunId" TEXT,
    "agentStepId" TEXT,
    "observedValue" INTEGER NOT NULL,
    "observedTotal" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "externalProvider" TEXT,
    "externalScope" TEXT,
    "retrievedAt" DATETIME,
    "responseDigest" TEXT,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "semantics" TEXT,
    "digest" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentMeasurement_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentMeasurement_experimentId_key" ON "ExperimentMeasurement"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentMeasurement_agentStepId_key" ON "ExperimentMeasurement"("agentStepId");

-- CreateIndex
CREATE INDEX "ExperimentMeasurement_userId_rule_idx" ON "ExperimentMeasurement"("userId", "rule");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_executionRunId_key" ON "Experiment"("executionRunId");
