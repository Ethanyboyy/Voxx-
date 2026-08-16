-- AlterTable
ALTER TABLE "LabSimulationRun" ADD COLUMN "failureAnalysis" TEXT;

-- CreateTable
CREATE TABLE "LabResearchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
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
    CONSTRAINT "LabResearchItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabSuit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "codename" TEXT NOT NULL,
    "designation" TEXT NOT NULL DEFAULT 'MK-I',
    "archetype" TEXT NOT NULL,
    "description" TEXT,
    "colorPrimary" TEXT NOT NULL DEFAULT '#a855f7',
    "colorSecondary" TEXT NOT NULL DEFAULT '#0a0616',
    "silhouette" TEXT NOT NULL DEFAULT 'ATHLETIC',
    "materialLanguage" TEXT NOT NULL DEFAULT 'TEXTILE',
    "patternStyle" TEXT NOT NULL DEFAULT 'WEB_GEOMETRY',
    "armorLevel" TEXT NOT NULL DEFAULT 'LIGHT',
    "maskLensStyle" TEXT NOT NULL DEFAULT 'ANGULAR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersionId" TEXT,
    CONSTRAINT "LabSuit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSuit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSuit_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "LabSuitVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabSuit" ("archetype", "codename", "colorPrimary", "colorSecondary", "createdAt", "currentVersionId", "description", "designation", "id", "projectId", "status", "updatedAt", "userId") SELECT "archetype", "codename", "colorPrimary", "colorSecondary", "createdAt", "currentVersionId", "description", "designation", "id", "projectId", "status", "updatedAt", "userId" FROM "LabSuit";
DROP TABLE "LabSuit";
ALTER TABLE "new_LabSuit" RENAME TO "LabSuit";
CREATE UNIQUE INDEX "LabSuit_currentVersionId_key" ON "LabSuit"("currentVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
