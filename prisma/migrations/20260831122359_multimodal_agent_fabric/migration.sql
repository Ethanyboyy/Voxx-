-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'GENERATED',
    "label" TEXT NOT NULL,
    "note" TEXT,
    "currentVersionId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Artifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ArtifactVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" REAL,
    "provider" TEXT,
    "model" TEXT,
    "prompt" TEXT,
    "parameters" TEXT,
    "capabilityRunId" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactVersion_capabilityRunId_fkey" FOREIGN KEY ("capabilityRunId") REFERENCES "CapabilityRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtifactLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactLink_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ArtifactVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactLink_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ArtifactVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CapabilityRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "providerRunId" TEXT,
    "traceId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "costUsd" REAL,
    CONSTRAINT "CapabilityRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_currentVersionId_key" ON "Artifact"("currentVersionId");

-- CreateIndex
CREATE INDEX "Artifact_userId_kind_idx" ON "Artifact"("userId", "kind");

-- CreateIndex
CREATE INDEX "Artifact_subjectType_subjectId_idx" ON "Artifact"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ArtifactVersion_capabilityRunId_idx" ON "ArtifactVersion"("capabilityRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_version_key" ON "ArtifactVersion"("artifactId", "version");

-- CreateIndex
CREATE INDEX "ArtifactLink_childId_idx" ON "ArtifactLink"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactLink_parentId_childId_role_key" ON "ArtifactLink"("parentId", "childId", "role");

-- CreateIndex
CREATE INDEX "CapabilityRun_userId_startedAt_idx" ON "CapabilityRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "CapabilityRun_traceId_idx" ON "CapabilityRun"("traceId");

-- CreateIndex
CREATE INDEX "CapabilityRun_userId_capability_startedAt_idx" ON "CapabilityRun"("userId", "capability", "startedAt");
