-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Opportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Opportunity" ("confidence", "createdAt", "description", "effort", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "risk", "status", "title", "updatedAt", "userId") SELECT "confidence", "createdAt", "description", "effort", "estimatedValue", "evidence", "id", "nextAction", "objectiveId", "risk", "status", "title", "updatedAt", "userId" FROM "Opportunity";
DROP TABLE "Opportunity";
ALTER TABLE "new_Opportunity" RENAME TO "Opportunity";
CREATE TABLE "new_ResearchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "title" TEXT,
    "sourceUrl" TEXT,
    "summary" TEXT,
    "relevance" REAL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "opportunityId" TEXT,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchItem" ("confidence", "createdAt", "id", "provider", "query", "relevance", "retrievedAt", "sourceUrl", "summary", "title", "userId") SELECT "confidence", "createdAt", "id", "provider", "query", "relevance", "retrievedAt", "sourceUrl", "summary", "title", "userId" FROM "ResearchItem";
DROP TABLE "ResearchItem";
ALTER TABLE "new_ResearchItem" RENAME TO "ResearchItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
