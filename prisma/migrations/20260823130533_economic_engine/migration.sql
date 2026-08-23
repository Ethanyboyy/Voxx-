-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "supervisorRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "summary" TEXT NOT NULL,
    "expectedResult" TEXT,
    "observedResult" TEXT,
    "variance" TEXT,
    "costUsd" REAL,
    "timeSpentMinutes" INTEGER,
    "lessons" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Outcome_supervisorRunId_fkey" FOREIGN KEY ("supervisorRunId") REFERENCES "SupervisorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Objective" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "strategy" TEXT,
    "assumptions" TEXT,
    "targetValue" REAL,
    "targetUnit" TEXT,
    "currentValue" REAL,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceOpportunityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Objective_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Objective_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Objective" ("assumptions", "createdAt", "currentValue", "description", "id", "status", "strategy", "targetDate", "targetUnit", "targetValue", "title", "updatedAt", "userId") SELECT "assumptions", "createdAt", "currentValue", "description", "id", "status", "strategy", "targetDate", "targetUnit", "targetValue", "title", "updatedAt", "userId" FROM "Objective";
DROP TABLE "Objective";
ALTER TABLE "new_Objective" RENAME TO "Objective";
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
    CONSTRAINT "Opportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Opportunity" ("confidence", "createdAt", "description", "effort", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "projectId", "risk", "status", "title", "updatedAt", "userId") SELECT "confidence", "createdAt", "description", "effort", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "projectId", "risk", "status", "title", "updatedAt", "userId" FROM "Opportunity";
DROP TABLE "Opportunity";
ALTER TABLE "new_Opportunity" RENAME TO "Opportunity";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "autonomyMode" TEXT NOT NULL DEFAULT 'AUTONOMOUS_APPROVAL_GATES',
    "maxAutonomousSpendUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("autonomyMode", "createdAt", "email", "id", "name", "passwordHash", "updatedAt") SELECT "autonomyMode", "createdAt", "email", "id", "name", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_supervisorRunId_key" ON "Outcome"("supervisorRunId");
