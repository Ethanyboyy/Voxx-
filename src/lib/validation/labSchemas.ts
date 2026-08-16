// Zod schemas for the Spider-Man Laboratory API surface. Kept in a separate
// module from schemas.ts (rather than appended to that 350+ line file) since
// this is a large, self-contained domain — see CLAUDE.md project layout.
import { z } from "zod";

export const labConfidenceSchema = z.enum(["VERIFIED", "ESTIMATED", "HYPOTHETICAL", "UNKNOWN"]);
export const labDesignStatusSchema = z.enum(["ACTIVE", "EXPERIMENTAL", "PREFERRED", "ARCHIVED"]);
export const labProjectStatusSchema = z.enum(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
export const labExperimentStatusSchema = z.enum(["PLANNED", "RUNNING", "COMPLETED", "FAILED", "ABANDONED"]);
export const labTrainingCategorySchema = z.enum([
  "MOVEMENT",
  "AGILITY",
  "BALANCE",
  "REACTION",
  "OBSTACLE_NAVIGATION",
  "DEFENSIVE_POSITIONING",
  "SITUATIONAL_AWARENESS",
  "DE_ESCALATION",
  "EMERGENCY_ESCAPE",
  "SPARRING",
]);
export const labScenarioEnvironmentSchema = z.enum([
  "ROOFTOP",
  "WAREHOUSE",
  "URBAN_STREET",
  "INDUSTRIAL_FACILITY",
  "FOREST",
  "TRAINING_ARENA",
  "LABORATORY",
]);
export const labScenarioObjectiveSchema = z.enum([
  "NAVIGATION",
  "RESCUE",
  "ESCAPE",
  "TIMED_TRAVERSAL",
  "EQUIPMENT_TEST",
  "ENVIRONMENTAL_TEST",
  "TRAINING",
]);
export const labDifficultySchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERIMENTAL"]);
export const labSilhouetteSchema = z.enum(["ATHLETIC", "STREAMLINED", "ARMORED", "TACTICAL", "LIGHTWEIGHT", "STEALTH"]);
export const labMaterialLanguageSchema = z.enum([
  "TEXTILE",
  "CARBON_COMPOSITE",
  "SYNTHETIC_FIBER",
  "FLEXIBLE_POLYMER",
  "EXPERIMENTAL_MATERIAL",
]);
export const labPatternStyleSchema = z.enum(["WEB_GEOMETRY", "GEOMETRIC", "ORGANIC", "TECHNICAL", "MINIMAL"]);
export const labArmorLevelSchema = z.enum(["NONE", "LIGHT", "MODERATE", "EXPERIMENTAL"]);
export const labMaskLensStyleSchema = z.enum(["NARROW", "WIDE", "ANGULAR", "ROUND", "MECHANICAL"]);
export const labResearchCategorySchema = z.enum([
  "MATERIALS",
  "TEXTILES",
  "POLYMERS",
  "COMPOSITES",
  "ROBOTICS",
  "WEARABLE_TECHNOLOGY",
  "SENSORS",
  "PHYSICS",
  "BIOMECHANICS",
  "THERMAL_MANAGEMENT",
  "MANUFACTURING",
  "PROTECTIVE_EQUIPMENT",
]);

export const suitStatsSchema = z.object({
  stealth: z.number().min(0).max(100),
  durability: z.number().min(0).max(100),
  mobility: z.number().min(0).max(100),
  stretchiness: z.number().min(0).max(100),
  weightKg: z.number().min(0),
  thermalLoadC: z.number(),
  protection: z.number().min(0).max(100),
  environmentalResistance: z.number().min(0).max(100),
  manufacturingComplexity: z.number().min(0).max(100),
  estimatedBuildHours: z.number().min(0),
  estimatedCostUsd: z.number().min(0),
  flexibility: z.number().min(0).max(100),
  impactResistance: z.number().min(0).max(100),
  visibility: z.number().min(0).max(100),
  noiseProfile: z.number().min(0).max(100),
  sensorCapacity: z.number().min(0).max(100),
  energyRequirementW: z.number().min(0),
  maintenanceComplexity: z.number().min(0).max(100),
  confidence: labConfidenceSchema.optional(),
});

export const createSuitSchema = z.object({
  projectId: z.string().optional(),
  codename: z.string().min(1).max(60),
  designation: z.string().max(30).optional(),
  archetype: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),
  colorPrimary: z.string().max(20).optional(),
  colorSecondary: z.string().max(20).optional(),
  silhouette: labSilhouetteSchema.optional(),
  materialLanguage: labMaterialLanguageSchema.optional(),
  patternStyle: labPatternStyleSchema.optional(),
  armorLevel: labArmorLevelSchema.optional(),
  maskLensStyle: labMaskLensStyleSchema.optional(),
  status: labDesignStatusSchema.optional(),
  stats: suitStatsSchema,
  versionLabel: z.string().max(20).optional(),
});

export const updateSuitSchema = z.object({
  codename: z.string().min(1).max(60).optional(),
  designation: z.string().max(30).optional(),
  archetype: z.string().min(1).max(40).optional(),
  description: z.string().max(2000).optional(),
  colorPrimary: z.string().max(20).optional(),
  colorSecondary: z.string().max(20).optional(),
  silhouette: labSilhouetteSchema.optional(),
  materialLanguage: labMaterialLanguageSchema.optional(),
  patternStyle: labPatternStyleSchema.optional(),
  armorLevel: labArmorLevelSchema.optional(),
  maskLensStyle: labMaskLensStyleSchema.optional(),
  status: labDesignStatusSchema.optional(),
  projectId: z.string().nullable().optional(),
});

export const createSuitVersionSchema = z.object({
  label: z.string().min(1).max(20),
  note: z.string().max(1000).optional(),
  parentVersionId: z.string().optional(),
  stats: suitStatsSchema,
  makeCurrent: z.boolean().optional(),
});

export const duplicateSuitSchema = z.object({ newCodename: z.string().min(1).max(60) });

export const gadgetStatsSchema = z.object({
  massKg: z.number().min(0),
  powerRequirementW: z.number().min(0),
  batteryLifeHours: z.number().min(0),
  durability: z.number().min(0).max(100),
  sensorAccuracy: z.number().min(0).max(100),
  rangeM: z.number().min(0),
  manufacturingComplexity: z.number().min(0).max(100),
  estimatedCostUsd: z.number().min(0),
  reliability: z.number().min(0).max(100),
  confidence: labConfidenceSchema.optional(),
});

export const createGadgetSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(60),
  description: z.string().max(2000).optional(),
  status: labDesignStatusSchema.optional(),
  stats: gadgetStatsSchema,
  versionLabel: z.string().max(20).optional(),
});

export const createGadgetVersionSchema = z.object({
  label: z.string().min(1).max(20),
  note: z.string().max(1000).optional(),
  stats: gadgetStatsSchema,
  makeCurrent: z.boolean().optional(),
});

export const createComponentSchema = z.object({
  suitId: z.string().optional(),
  gadgetId: z.string().optional(),
  parentId: z.string().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  materialId: z.string().optional(),
  massKg: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
  confidence: labConfidenceSchema.optional(),
  order: z.number().optional(),
});

export const createMaterialSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(60),
  densityGCm3: z.number().min(0),
  tensileStrengthMpa: z.number().min(0),
  elasticityPercent: z.number().min(0),
  abrasionResistance: z.number().min(0).max(100),
  temperatureResistanceC: z.number(),
  moistureResistance: z.number().min(0).max(100),
  costPerKgUsd: z.number().min(0),
  notes: z.string().max(2000).optional(),
  confidence: labConfidenceSchema.optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  status: labProjectStatusSchema.optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  status: labProjectStatusSchema.optional(),
});

export const createWebProfileSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  material: z.object({
    densityGCm3: z.number().min(0),
    tensileStrengthMpa: z.number().min(0),
    elasticityPercent: z.number().min(0),
    abrasionResistance: z.number().min(0).max(100),
    temperatureResistanceC: z.number(),
    moistureResistance: z.number().min(0).max(100),
    storageVolumeCm3: z.number().min(0),
    massG: z.number().min(0),
    confidence: labConfidenceSchema.optional(),
  }),
  deployment: z.object({
    deploymentSpeedMs: z.number().min(0),
    lineLengthM: z.number().min(0),
    cartridgeSizeCm3: z.number().min(0),
    systemMassG: z.number().min(0),
    energyRequirementJ: z.number().min(0),
    deploymentReliabilityPct: z.number().min(0).max(100),
    confidence: labConfidenceSchema.optional(),
  }),
  attachment: z.object({
    attachmentType: z.string().min(1).max(60),
    theoreticalHoldingStrengthN: z.number().min(0),
    environmentalAssumptions: z.string().min(1).max(1000),
    geometry: z.string().min(1).max(500),
    structuralAssumptions: z.string().min(1).max(1000),
    estimatedFailureProbabilityPct: z.number().min(0).max(100),
    confidence: labConfidenceSchema.optional(),
  }),
});

export const addLoadModelSchema = z.object({
  label: z.string().min(1).max(60),
  userMassKg: z.number().min(1),
  equipmentMassKg: z.number().min(0),
  swingRadiusM: z.number().min(0.1),
  velocityMs: z.number().min(0),
  gravityMs2: z.number().min(0).optional(),
});

export const createScenarioSchema = z.object({
  name: z.string().min(1).max(80),
  environment: labScenarioEnvironmentSchema,
  objectiveType: labScenarioObjectiveSchema,
  difficulty: labDifficultySchema,
  description: z.string().max(2000).optional(),
  timeOfDay: z.string().max(20).optional(),
  precipitation: z.string().max(20).optional(),
  windMs: z.number().min(0).optional(),
  temperatureC: z.number().optional(),
  fogPercent: z.number().min(0).max(100).optional(),
  gravityMs2: z.number().min(0).optional(),
  surfaceType: z.string().max(40).optional(),
  elevationM: z.number().optional(),
  obstacleCount: z.number().min(0).optional(),
});

export const createSimulationSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).max(80),
  scenarioId: z.string().min(1),
  suitId: z.string().optional(),
  webProfileId: z.string().optional(),
  gadgetIds: z.array(z.string()).optional(),
  userMassKg: z.number().min(1).optional(),
  reactionTimeMs: z.number().min(0).optional(),
  skillLevel: z.number().min(0).max(100).optional(),
});

export const executeSimulationSchema = z.object({ seed: z.number().int().optional() });

export const createExperimentSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(120),
  hypothesis: z.string().min(1).max(2000),
  objective: z.string().max(2000).optional(),
  variables: z.array(z.object({ name: z.string(), value: z.string(), unit: z.string().optional() })).optional(),
  equipmentNotes: z.string().max(2000).optional(),
  environmentNotes: z.string().max(2000).optional(),
  expectedOutcome: z.string().max(2000).optional(),
  suitId: z.string().optional(),
  simulationRunId: z.string().optional(),
  confidence: labConfidenceSchema.optional(),
});

export const updateExperimentSchema = z.object({
  status: labExperimentStatusSchema.optional(),
  nextIteration: z.string().max(2000).optional(),
  expectedOutcome: z.string().max(2000).optional(),
});

export const addExperimentResultSchema = z.object({
  outcome: z.string().min(1).max(2000),
  learnings: z.string().max(2000).optional(),
  confidence: labConfidenceSchema.optional(),
});

export const recordTrainingSessionSchema = z.object({
  scenarioId: z.string().optional(),
  reactionTimeMs: z.number().min(0).optional(),
  completionTimeS: z.number().min(0).optional(),
  movementEfficiencyPercent: z.number().min(0).max(100).optional(),
  staminaUsedPercent: z.number().min(0).max(100).optional(),
  balanceScore: z.number().min(0).max(100).optional(),
  accuracyPercent: z.number().min(0).max(100).optional(),
  decisionQualityPercent: z.number().min(0).max(100).optional(),
  defensiveSuccessPercent: z.number().min(0).max(100).optional(),
  mistakes: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export const completeTutorialSchema = z.object({ score: z.number().min(0).max(100) });

export const addDesignNoteSchema = z.object({
  subjectType: z.string().min(1).max(40),
  subjectId: z.string().min(1),
  content: z.string().min(1).max(4000),
});

export const labAiCommandSchema = z.object({ message: z.string().min(1).max(2000) });

export const createResearchItemSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(160),
  category: labResearchCategorySchema,
  source: z.string().max(300).optional(),
  sourceDate: z.string().datetime().optional(),
  confidence: labConfidenceSchema.optional(),
  relevance: z.number().min(0).max(100).optional(),
  notes: z.string().max(4000).optional(),
});

export const updateResearchItemSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  category: labResearchCategorySchema.optional(),
  source: z.string().max(300).optional(),
  sourceDate: z.string().datetime().optional(),
  confidence: labConfidenceSchema.optional(),
  relevance: z.number().min(0).max(100).optional(),
  notes: z.string().max(4000).optional(),
});
