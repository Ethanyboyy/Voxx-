-- CreateTable
CREATE TABLE "AgentStateTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentStateTransition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentStateTransition_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "senderKind" TEXT NOT NULL DEFAULT 'AGENT',
    "fromAgentId" TEXT,
    "toAgentId" TEXT,
    "kind" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" TEXT,
    "opportunityId" TEXT,
    "strategyId" TEXT,
    "runId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "AgentMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_fromAgentId_fkey" FOREIGN KEY ("fromAgentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_toAgentId_fkey" FOREIGN KEY ("toAgentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ownerAgentId" TEXT,
    "opportunityId" TEXT,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "mechanism" TEXT,
    "assumptions" TEXT NOT NULL DEFAULT '[]',
    "evidence" TEXT,
    "participatingAgentIds" TEXT NOT NULL DEFAULT '[]',
    "executionPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "maxCapitalCents" INTEGER NOT NULL DEFAULT 0,
    "expectedReturnCents" INTEGER,
    "expectedDurationDays" INTEGER,
    "probabilityOfSuccess" REAL,
    "maxLossCents" INTEGER,
    "risk" TEXT,
    "targetCategories" TEXT NOT NULL DEFAULT '[]',
    "outcomeReason" TEXT,
    "lessons" TEXT NOT NULL DEFAULT '[]',
    "replicatedFromId" TEXT,
    "activatedByHumanAt" DATETIME,
    "killedAt" DATETIME,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Strategy_ownerAgentId_fkey" FOREIGN KEY ("ownerAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Strategy_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Strategy_replicatedFromId_fkey" FOREIGN KEY ("replicatedFromId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CapitalAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "strategyId" TEXT,
    "requestedCents" INTEGER NOT NULL,
    "approvedCents" INTEGER NOT NULL DEFAULT 0,
    "consumedCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "rationale" TEXT NOT NULL,
    "governorVerdict" TEXT,
    "governorReasons" TEXT,
    "decisionRecord" TEXT,
    "positionSnapshot" TEXT,
    "approvalGrantId" TEXT,
    "runId" TEXT,
    "stepId" TEXT,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "releasedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "CapitalAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CapitalAllocation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CapitalAllocation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CapitalAllocation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "allowedCapabilities" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "role" TEXT,
    "persona" TEXT,
    "runtimeState" TEXT NOT NULL DEFAULT 'IDLE',
    "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "autonomyMode" TEXT NOT NULL DEFAULT 'SUPERVISED',
    "allowedTools" TEXT,
    "currentObjectiveId" TEXT,
    "currentRunId" TEXT,
    "currentStage" TEXT,
    "confidence" REAL,
    "heartbeatAt" DATETIME,
    "lastActivityAt" DATETIME,
    "nextWakeAt" DATETIME,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" DATETIME,
    "suspendedReason" TEXT,
    "leaseId" TEXT,
    "leaseExpiresAt" DATETIME,
    "maxRequestCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Agent_currentObjectiveId_fkey" FOREIGN KEY ("currentObjectiveId") REFERENCES "Objective" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("allowedCapabilities", "createdAt", "description", "id", "instructions", "name", "status", "updatedAt", "userId") SELECT "allowedCapabilities", "createdAt", "description", "id", "instructions", "name", "status", "updatedAt", "userId" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE INDEX "Agent_userId_runtimeState_idx" ON "Agent"("userId", "runtimeState");
CREATE INDEX "Agent_userId_role_idx" ON "Agent"("userId", "role");
CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "agentId" TEXT,
    "supervisorRunId" TEXT,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "error" TEXT,
    "traceId" TEXT,
    "plan" TEXT,
    "strategyId" TEXT,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_supervisorRunId_fkey" FOREIGN KEY ("supervisorRunId") REFERENCES "SupervisorRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("agentId", "completedAt", "createdAt", "currentStep", "error", "id", "objective", "plan", "projectId", "result", "status", "supervisorRunId", "traceId", "updatedAt", "userId") SELECT "agentId", "completedAt", "createdAt", "currentStep", "error", "id", "objective", "plan", "projectId", "result", "status", "supervisorRunId", "traceId", "updatedAt", "userId" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_userId_traceId_idx" ON "AgentRun"("userId", "traceId");
CREATE TABLE "new_Opportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimatedValue" REAL,
    "effort" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "risk" TEXT,
    "nextAction" TEXT,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDEA',
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "category" TEXT,
    "source" TEXT,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedStartupCost" REAL,
    "estimatedOperatingCost" REAL,
    "estimatedMargin" REAL,
    "estimatedTimeToRevenueDays" INTEGER,
    "complexity" TEXT,
    "competition" TEXT,
    "scalability" TEXT,
    "requiredHumanInvolvement" TEXT,
    "requiredCapabilities" TEXT,
    "dependencies" TEXT,
    "rationale" TEXT,
    "scoreSnapshot" REAL,
    "scoreBreakdown" TEXT,
    "discoveredByAgentId" TEXT,
    "strategyId" TEXT,
    "participatingAgentIds" TEXT NOT NULL DEFAULT '[]',
    "requiredCapitalCents" INTEGER,
    "expectedRevenueCents" INTEGER,
    "expectedProfitCents" INTEGER,
    "probabilityOfSuccess" REAL,
    "maxLossCents" INTEGER,
    "downside" TEXT,
    "timeToPayoutDays" INTEGER,
    "requiredTools" TEXT,
    "policyStatus" TEXT,
    "correlationId" TEXT,
    CONSTRAINT "Opportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_discoveredByAgentId_fkey" FOREIGN KEY ("discoveredByAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Opportunity" ("category", "competition", "complexity", "confidence", "createdAt", "dependencies", "description", "discoveredAt", "effort", "estimatedMargin", "estimatedOperatingCost", "estimatedStartupCost", "estimatedTimeToRevenueDays", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "projectId", "rationale", "requiredCapabilities", "requiredHumanInvolvement", "risk", "scalability", "scoreBreakdown", "scoreSnapshot", "source", "status", "title", "updatedAt", "userId") SELECT "category", "competition", "complexity", "confidence", "createdAt", "dependencies", "description", "discoveredAt", "effort", "estimatedMargin", "estimatedOperatingCost", "estimatedStartupCost", "estimatedTimeToRevenueDays", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "projectId", "rationale", "requiredCapabilities", "requiredHumanInvolvement", "risk", "scalability", "scoreBreakdown", "scoreSnapshot", "source", "status", "title", "updatedAt", "userId" FROM "Opportunity";
DROP TABLE "Opportunity";
ALTER TABLE "new_Opportunity" RENAME TO "Opportunity";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AgentStateTransition_userId_agentId_createdAt_idx" ON "AgentStateTransition"("userId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentStateTransition_userId_correlationId_idx" ON "AgentStateTransition"("userId", "correlationId");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_toAgentId_createdAt_idx" ON "AgentMessage"("userId", "toAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_fromAgentId_createdAt_idx" ON "AgentMessage"("userId", "fromAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_correlationId_idx" ON "AgentMessage"("userId", "correlationId");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_kind_createdAt_idx" ON "AgentMessage"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Strategy_userId_status_idx" ON "Strategy"("userId", "status");

-- CreateIndex
CREATE INDEX "Strategy_userId_ownerAgentId_idx" ON "Strategy"("userId", "ownerAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalAllocation_idempotencyKey_key" ON "CapitalAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CapitalAllocation_userId_status_idx" ON "CapitalAllocation"("userId", "status");

-- CreateIndex
CREATE INDEX "CapitalAllocation_userId_agentId_requestedAt_idx" ON "CapitalAllocation"("userId", "agentId", "requestedAt");

-- CreateIndex
CREATE INDEX "CapitalAllocation_userId_strategyId_status_idx" ON "CapitalAllocation"("userId", "strategyId", "status");

-- CreateIndex
CREATE INDEX "CapitalAllocation_userId_correlationId_idx" ON "CapitalAllocation"("userId", "correlationId");
