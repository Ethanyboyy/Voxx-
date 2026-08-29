-- AlterTable
ALTER TABLE "Objective" ADD COLUMN "successCriteria" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "supervisorRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
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
INSERT INTO "new_Outcome" ("confidence", "costUsd", "createdAt", "evidence", "expectedResult", "id", "lessons", "observedResult", "status", "summary", "supervisorRunId", "timeSpentMinutes", "userId", "variance") SELECT "confidence", "costUsd", "createdAt", "evidence", "expectedResult", "id", "lessons", "observedResult", "status", "summary", "supervisorRunId", "timeSpentMinutes", "userId", "variance" FROM "Outcome";
DROP TABLE "Outcome";
ALTER TABLE "new_Outcome" RENAME TO "Outcome";
CREATE UNIQUE INDEX "Outcome_supervisorRunId_key" ON "Outcome"("supervisorRunId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
