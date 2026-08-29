-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabExperiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "objective" TEXT,
    "variables" TEXT,
    "equipmentNotes" TEXT,
    "environmentNotes" TEXT,
    "expectedOutcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "suitId" TEXT,
    "componentId" TEXT,
    "simulationRunId" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    "objectiveId" TEXT,
    "nextIteration" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "LabSimulationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabExperiment" ("code", "componentId", "confidence", "createdAt", "environmentNotes", "equipmentNotes", "expectedOutcome", "hypothesis", "id", "nextIteration", "objective", "projectId", "simulationRunId", "status", "suitId", "title", "updatedAt", "userId", "variables") SELECT "code", "componentId", "confidence", "createdAt", "environmentNotes", "equipmentNotes", "expectedOutcome", "hypothesis", "id", "nextIteration", "objective", "projectId", "simulationRunId", "status", "suitId", "title", "updatedAt", "userId", "variables" FROM "LabExperiment";
DROP TABLE "LabExperiment";
ALTER TABLE "new_LabExperiment" RENAME TO "LabExperiment";
CREATE UNIQUE INDEX "LabExperiment_userId_code_key" ON "LabExperiment"("userId", "code");
CREATE TABLE "new_LabSimulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "suitId" TEXT,
    "webProfileId" TEXT,
    "objectiveId" TEXT,
    "userMassKg" REAL NOT NULL DEFAULT 75,
    "reactionTimeMs" REAL NOT NULL DEFAULT 250,
    "skillLevel" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabSimulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LabScenario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_webProfileId_fkey" FOREIGN KEY ("webProfileId") REFERENCES "LabWebProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabSimulation" ("createdAt", "id", "name", "projectId", "reactionTimeMs", "scenarioId", "skillLevel", "suitId", "updatedAt", "userId", "userMassKg", "webProfileId") SELECT "createdAt", "id", "name", "projectId", "reactionTimeMs", "scenarioId", "skillLevel", "suitId", "updatedAt", "userId", "userMassKg", "webProfileId" FROM "LabSimulation";
DROP TABLE "LabSimulation";
ALTER TABLE "new_LabSimulation" RENAME TO "LabSimulation";
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
    "objectiveId" TEXT,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchItem" ("confidence", "createdAt", "id", "opportunityId", "provider", "query", "relevance", "retrievedAt", "sourceUrl", "summary", "title", "userId") SELECT "confidence", "createdAt", "id", "opportunityId", "provider", "query", "relevance", "retrievedAt", "sourceUrl", "summary", "title", "userId" FROM "ResearchItem";
DROP TABLE "ResearchItem";
ALTER TABLE "new_ResearchItem" RENAME TO "ResearchItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
