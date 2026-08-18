-- CreateTable
CREATE TABLE "LabComponentDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabComponentDependency_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponentDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "LabComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT,
    "suitId" TEXT,
    "gadgetId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "materialId" TEXT,
    "massKg" REAL,
    "notes" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "order" INTEGER NOT NULL DEFAULT 0,
    "subsystem" TEXT,
    "powerDrawW" REAL,
    "costUsd" REAL,
    "riskLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "realityStatus" TEXT NOT NULL DEFAULT 'CONCEPT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabComponent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LabComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_gadgetId_fkey" FOREIGN KEY ("gadgetId") REFERENCES "LabGadget" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LabMaterial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabComponent" ("confidence", "createdAt", "description", "gadgetId", "id", "massKg", "materialId", "name", "notes", "order", "parentId", "suitId", "updatedAt") SELECT "confidence", "createdAt", "description", "gadgetId", "id", "massKg", "materialId", "name", "notes", "order", "parentId", "suitId", "updatedAt" FROM "LabComponent";
DROP TABLE "LabComponent";
ALTER TABLE "new_LabComponent" RENAME TO "LabComponent";
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
    "nextIteration" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "LabSimulationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabExperiment" ("code", "confidence", "createdAt", "environmentNotes", "equipmentNotes", "expectedOutcome", "hypothesis", "id", "nextIteration", "objective", "projectId", "simulationRunId", "status", "suitId", "title", "updatedAt", "userId", "variables") SELECT "code", "confidence", "createdAt", "environmentNotes", "equipmentNotes", "expectedOutcome", "hypothesis", "id", "nextIteration", "objective", "projectId", "simulationRunId", "status", "suitId", "title", "updatedAt", "userId", "variables" FROM "LabExperiment";
DROP TABLE "LabExperiment";
ALTER TABLE "new_LabExperiment" RENAME TO "LabExperiment";
CREATE UNIQUE INDEX "LabExperiment_userId_code_key" ON "LabExperiment"("userId", "code");
CREATE TABLE "new_LabResearchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "componentId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT,
    "sourceDate" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "relevance" INTEGER NOT NULL DEFAULT 50,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabResearchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabResearchItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResearchItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabResearchItem" ("category", "confidence", "createdAt", "id", "notes", "projectId", "relevance", "source", "sourceDate", "title", "updatedAt", "userId") SELECT "category", "confidence", "createdAt", "id", "notes", "projectId", "relevance", "source", "sourceDate", "title", "updatedAt", "userId" FROM "LabResearchItem";
DROP TABLE "LabResearchItem";
ALTER TABLE "new_LabResearchItem" RENAME TO "LabResearchItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "LabComponentDependency_componentId_dependsOnId_key" ON "LabComponentDependency"("componentId", "dependsOnId");
