-- AlterTable
ALTER TABLE "Event" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "Event" ADD COLUMN "subjectType" TEXT;

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN "supersededAt" DATETIME;

-- CreateTable
CREATE TABLE "MemoryEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryEmbedding_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromMemoryId" TEXT NOT NULL,
    "toMemoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryRelation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryRelation_fromMemoryId_fkey" FOREIGN KEY ("fromMemoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryRelation_toMemoryId_fkey" FOREIGN KEY ("toMemoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "connection" TEXT,
    "implication" TEXT,
    "suggestedAction" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionPayload" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "requiredLevel" TEXT NOT NULL DEFAULT 'RECOMMEND',
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Proposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ENTITY',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "memoryId" TEXT,
    "projectId" TEXT,
    "goalId" TEXT,
    "taskId" TEXT,
    "decisionId" TEXT,
    "ideaId" TEXT,
    "experimentId" TEXT,
    "researchItemId" TEXT,
    CONSTRAINT "KnowledgeNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeNode_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeNode" ("createdAt", "description", "id", "label", "type", "updatedAt", "userId") SELECT "createdAt", "description", "id", "label", "type", "updatedAt", "userId" FROM "KnowledgeNode";
DROP TABLE "KnowledgeNode";
ALTER TABLE "new_KnowledgeNode" RENAME TO "KnowledgeNode";
CREATE UNIQUE INDEX "KnowledgeNode_memoryId_key" ON "KnowledgeNode"("memoryId");
CREATE UNIQUE INDEX "KnowledgeNode_projectId_key" ON "KnowledgeNode"("projectId");
CREATE UNIQUE INDEX "KnowledgeNode_goalId_key" ON "KnowledgeNode"("goalId");
CREATE UNIQUE INDEX "KnowledgeNode_taskId_key" ON "KnowledgeNode"("taskId");
CREATE UNIQUE INDEX "KnowledgeNode_decisionId_key" ON "KnowledgeNode"("decisionId");
CREATE UNIQUE INDEX "KnowledgeNode_ideaId_key" ON "KnowledgeNode"("ideaId");
CREATE UNIQUE INDEX "KnowledgeNode_experimentId_key" ON "KnowledgeNode"("experimentId");
CREATE UNIQUE INDEX "KnowledgeNode_researchItemId_key" ON "KnowledgeNode"("researchItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEmbedding_memoryId_key" ON "MemoryEmbedding"("memoryId");
