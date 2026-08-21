-- CreateTable
CREATE TABLE "LabRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "suitId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'HYPOTHESIS',
    "verificationMethod" TEXT,
    "evidence" TEXT,
    "subsystem" TEXT,
    "componentId" TEXT,
    "experimentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabRequirement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabRequirement_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabRequirement_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabRequirement_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "LabExperiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabEngineeringQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "suitId" TEXT,
    "question" TEXT NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
    "subsystem" TEXT,
    "researchStatus" TEXT,
    "currentHypothesis" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    "nextAction" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabEngineeringQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabEngineeringQuestion_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "suitId" TEXT,
    "decision" TEXT NOT NULL,
    "context" TEXT,
    "options" TEXT,
    "selectedOption" TEXT,
    "rationale" TEXT,
    "evidence" TEXT,
    "tradeoffs" TEXT,
    "author" TEXT NOT NULL DEFAULT 'user',
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabDecision_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabResearchLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabResearchLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabResearchLink_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LabResearchLink_researchItemId_subjectType_subjectId_key" ON "LabResearchLink"("researchItemId", "subjectType", "subjectId");
