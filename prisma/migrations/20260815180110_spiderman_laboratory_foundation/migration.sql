-- CreateTable
CREATE TABLE "LabProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSuit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "codename" TEXT NOT NULL,
    "designation" TEXT NOT NULL DEFAULT 'MK-I',
    "archetype" TEXT NOT NULL,
    "description" TEXT,
    "colorPrimary" TEXT NOT NULL DEFAULT '#a855f7',
    "colorSecondary" TEXT NOT NULL DEFAULT '#0a0616',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersionId" TEXT,
    CONSTRAINT "LabSuit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSuit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSuit_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "LabSuitVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSuitVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suitId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabSuitVersion_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSuitVersion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LabSuitVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSuitStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "stealth" INTEGER NOT NULL,
    "durability" INTEGER NOT NULL,
    "mobility" INTEGER NOT NULL,
    "stretchiness" INTEGER NOT NULL,
    "weightKg" REAL NOT NULL,
    "thermalLoadC" REAL NOT NULL,
    "protection" INTEGER NOT NULL,
    "environmentalResistance" INTEGER NOT NULL,
    "manufacturingComplexity" INTEGER NOT NULL,
    "estimatedBuildHours" REAL NOT NULL,
    "estimatedCostUsd" REAL NOT NULL,
    "flexibility" INTEGER NOT NULL,
    "impactResistance" INTEGER NOT NULL,
    "visibility" INTEGER NOT NULL,
    "noiseProfile" INTEGER NOT NULL,
    "sensorCapacity" INTEGER NOT NULL,
    "energyRequirementW" REAL NOT NULL,
    "maintenanceComplexity" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    CONSTRAINT "LabSuitStats_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LabSuitVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabComponent" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabComponent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LabComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_gadgetId_fkey" FOREIGN KEY ("gadgetId") REFERENCES "LabGadget" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabComponent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LabMaterial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabGadget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersionId" TEXT,
    CONSTRAINT "LabGadget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabGadget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabGadget_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "LabGadgetVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabGadgetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gadgetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabGadgetVersion_gadgetId_fkey" FOREIGN KEY ("gadgetId") REFERENCES "LabGadget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabGadgetStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "massKg" REAL NOT NULL,
    "powerRequirementW" REAL NOT NULL,
    "batteryLifeHours" REAL NOT NULL,
    "durability" INTEGER NOT NULL,
    "sensorAccuracy" INTEGER NOT NULL,
    "rangeM" REAL NOT NULL,
    "manufacturingComplexity" INTEGER NOT NULL,
    "estimatedCostUsd" REAL NOT NULL,
    "reliability" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    CONSTRAINT "LabGadgetStats_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LabGadgetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "densityGCm3" REAL NOT NULL,
    "tensileStrengthMpa" REAL NOT NULL,
    "elasticityPercent" REAL NOT NULL,
    "abrasionResistance" INTEGER NOT NULL,
    "temperatureResistanceC" REAL NOT NULL,
    "moistureResistance" INTEGER NOT NULL,
    "costPerKgUsd" REAL NOT NULL,
    "notes" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LabWebProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabWebProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabWebProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabWebMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "densityGCm3" REAL NOT NULL,
    "tensileStrengthMpa" REAL NOT NULL,
    "elasticityPercent" REAL NOT NULL,
    "abrasionResistance" INTEGER NOT NULL,
    "temperatureResistanceC" REAL NOT NULL,
    "moistureResistance" INTEGER NOT NULL,
    "storageVolumeCm3" REAL NOT NULL,
    "massG" REAL NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    CONSTRAINT "LabWebMaterial_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LabWebProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabWebDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "deploymentSpeedMs" REAL NOT NULL,
    "lineLengthM" REAL NOT NULL,
    "cartridgeSizeCm3" REAL NOT NULL,
    "systemMassG" REAL NOT NULL,
    "energyRequirementJ" REAL NOT NULL,
    "deploymentReliabilityPct" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    CONSTRAINT "LabWebDeployment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LabWebProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabWebAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "attachmentType" TEXT NOT NULL,
    "theoreticalHoldingStrengthN" REAL NOT NULL,
    "environmentalAssumptions" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "structuralAssumptions" TEXT NOT NULL,
    "estimatedFailureProbabilityPct" REAL NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    CONSTRAINT "LabWebAttachment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LabWebProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabWebLoadModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userMassKg" REAL NOT NULL,
    "equipmentMassKg" REAL NOT NULL,
    "swingRadiusM" REAL NOT NULL,
    "velocityMs" REAL NOT NULL,
    "staticLoadN" REAL NOT NULL,
    "dynamicLoadN" REAL NOT NULL,
    "accelerationMs2" REAL NOT NULL,
    "forceN" REAL NOT NULL,
    "tensionN" REAL NOT NULL,
    "safetyMarginPct" REAL NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabWebLoadModel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LabWebProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "objectiveType" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "description" TEXT,
    "timeOfDay" TEXT NOT NULL DEFAULT 'day',
    "precipitation" TEXT NOT NULL DEFAULT 'none',
    "windMs" REAL NOT NULL DEFAULT 0,
    "temperatureC" REAL NOT NULL DEFAULT 18,
    "fogPercent" INTEGER NOT NULL DEFAULT 0,
    "gravityMs2" REAL NOT NULL DEFAULT 9.81,
    "surfaceType" TEXT NOT NULL DEFAULT 'concrete',
    "elevationM" REAL NOT NULL DEFAULT 0,
    "obstacleCount" INTEGER NOT NULL DEFAULT 0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabScenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSimulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "suitId" TEXT,
    "webProfileId" TEXT,
    "userMassKg" REAL NOT NULL DEFAULT 75,
    "reactionTimeMs" REAL NOT NULL DEFAULT 250,
    "skillLevel" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabSimulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LabScenario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabSimulation_webProfileId_fkey" FOREIGN KEY ("webProfileId") REFERENCES "LabWebProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSimulationGadget" (
    "simulationId" TEXT NOT NULL,
    "gadgetId" TEXT NOT NULL,

    PRIMARY KEY ("simulationId", "gadgetId"),
    CONSTRAINT "LabSimulationGadget_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "LabSimulation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabSimulationGadget_gadgetId_fkey" FOREIGN KEY ("gadgetId") REFERENCES "LabGadget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabSimulationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "simulationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "seed" INTEGER NOT NULL,
    "durationS" REAL NOT NULL,
    "telemetry" TEXT NOT NULL,
    "peakVelocityMs" REAL,
    "peakForceN" REAL,
    "peakThermalLoadC" REAL,
    "fatigueEstimatePct" REAL,
    "warnings" TEXT,
    "summary" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabSimulationRun_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "LabSimulation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabExperiment" (
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
    "simulationRunId" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'HYPOTHETICAL',
    "nextIteration" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LabProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabExperiment_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "LabSimulationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabExperimentResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "learnings" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "LabExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabTrainingModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "durationMinutesEstimate" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LabTrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "reactionTimeMs" REAL,
    "completionTimeS" REAL,
    "movementEfficiencyPercent" REAL,
    "staminaUsedPercent" REAL,
    "balanceScore" REAL,
    "accuracyPercent" REAL,
    "decisionQualityPercent" REAL,
    "defensiveSuccessPercent" REAL,
    "mistakes" INTEGER,
    "score" INTEGER NOT NULL,
    "notes" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabTrainingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabTrainingSession_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "LabTrainingModule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabTrainingSession_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LabScenario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabTutorial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "demonstration" TEXT,
    "exercisePrompt" TEXT,
    "quiz" TEXT,
    "prerequisiteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabTutorial_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "LabTutorial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabTutorialProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tutorialId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabTutorialProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabTutorialProgress_tutorialId_fkey" FOREIGN KEY ("tutorialId") REFERENCES "LabTutorial" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabDesignNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabDesignNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LabSuit_currentVersionId_key" ON "LabSuit"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LabSuitVersion_suitId_label_key" ON "LabSuitVersion"("suitId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "LabSuitStats_versionId_key" ON "LabSuitStats"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "LabGadget_currentVersionId_key" ON "LabGadget"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LabGadgetVersion_gadgetId_label_key" ON "LabGadgetVersion"("gadgetId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "LabGadgetStats_versionId_key" ON "LabGadgetStats"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "LabWebMaterial_profileId_key" ON "LabWebMaterial"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "LabWebDeployment_profileId_key" ON "LabWebDeployment"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "LabWebAttachment_profileId_key" ON "LabWebAttachment"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "LabExperiment_userId_code_key" ON "LabExperiment"("userId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LabTutorialProgress_userId_tutorialId_key" ON "LabTutorialProgress"("userId", "tutorialId");
