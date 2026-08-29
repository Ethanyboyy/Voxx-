import { z } from "zod";

// Shared enum schemas mirror prisma/schema.prisma — kept here (not imported
// from the generated client) so this module has no Prisma runtime dependency.
export const confidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CONFIRMED"]);
export const memoryCategorySchema = z.enum([
  "FACT",
  "PREFERENCE",
  "GOAL",
  "PROJECT",
  "EXPERIENCE",
  "IDEA",
  "OBSERVATION",
  "HYPOTHESIS",
  "INFERENCE",
  "TEMPORARY_CONTEXT",
]);
export const cognitiveDimensionSchema = z.enum([
  "FOCUS",
  "TASK_SWITCHING",
  "COMPLETION_BEHAVIOR",
  "IDEA_GENERATION",
  "CREATIVITY",
  "LEARNING_BEHAVIOR",
  "DECISION_BEHAVIOR",
  "PLANNING_BEHAVIOR",
  "CONSISTENCY",
  "PROJECT_PERSISTENCE",
  "ATTENTION_PATTERNS",
  "PRODUCTIVITY_PATTERNS",
]);
export const capabilityLevelSchema = z.enum(["OBSERVE", "ANALYZE", "RECOMMEND", "ASK", "ACT"]);
export const projectStatusSchema = z.enum(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
export const goalStatusSchema = z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const taskDifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export const decisionStatusSchema = z.enum(["PENDING", "DECIDED", "REVISITED"]);
export const ideaStatusSchema = z.enum(["CAPTURED", "EXPLORING", "IN_EXPERIMENT", "EXECUTED", "ABANDONED"]);
export const experimentStatusSchema = z.enum(["PLANNED", "RUNNING", "COMPLETED", "ABANDONED"]);
export const knowledgeNodeTypeSchema = z.enum([
  "ENTITY",
  "TOPIC",
  "PROJECT",
  "GOAL",
  "CONCEPT",
  "PERSON",
  "ORGANIZATION",
  "OTHER",
]);
export const hypothesisStatusSchema = z.enum(["OPEN", "SUPPORTED", "REJECTED"]);
export const memoryRelationTypeSchema = z.enum([
  "RELATES_TO",
  "SUPERSEDES",
  "CONTRADICTS",
  "DERIVED_FROM",
  "SUPPORTS",
]);
export const proposalStatusSchema = z.enum(["PROPOSED", "APPROVED", "DENIED", "EXPIRED", "EXECUTED", "FAILED"]);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  name: z.string().min(1).max(200).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createMemorySchema = z.object({
  content: z.string().min(1).max(10_000),
  category: memoryCategorySchema,
  confidence: confidenceSchema.optional(),
  provenance: z.string().max(2000).optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(10_000).optional(),
  category: memoryCategorySchema.optional(),
  confidence: confidenceSchema.optional(),
  provenance: z.string().max(2000).optional(),
});

export const createMemoryRelationSchema = z.object({
  toMemoryId: z.string().min(1),
  type: memoryRelationTypeSchema,
  note: z.string().max(2000).optional(),
  confidence: confidenceSchema.optional(),
});

export const semanticSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const denyProposalSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const createConversationSchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().optional(),
});

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(20_000),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: projectStatusSchema.optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: projectStatusSchema.optional(),
});

export const createGoalSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: goalStatusSchema.optional(),
  targetDate: z.coerce.date().optional(),
});

export const createTaskSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.coerce.date().optional(),
  difficulty: taskDifficultySchema.optional(),
  estimatedMinutes: z.coerce.number().int().min(1).max(100_000).optional(),
  pros: z.array(z.string().min(1).max(200)).max(20).optional(),
  cons: z.array(z.string().min(1).max(200)).max(20).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  difficulty: taskDifficultySchema.nullable().optional(),
  estimatedMinutes: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  pros: z.array(z.string().min(1).max(200)).max(20).nullable().optional(),
  cons: z.array(z.string().min(1).max(200)).max(20).nullable().optional(),
});

export const createDecisionSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  alternatives: z.array(z.string()).optional(),
  chosenOption: z.string().max(500).optional(),
  status: decisionStatusSchema.optional(),
});

export const createIdeaSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: ideaStatusSchema.optional(),
});

export const createExperimentSchema = z.object({
  projectId: z.string().optional(),
  ideaId: z.string().optional(),
  hypothesis: z.string().min(1).max(2000),
  method: z.string().max(5000).optional(),
  status: experimentStatusSchema.optional(),
});

export const createExperimentResultSchema = z.object({
  outcome: z.string().min(1).max(5000),
  learnings: z.string().max(5000).optional(),
  confidence: confidenceSchema.optional(),
});

export const createObservationSchema = z.object({
  dimension: cognitiveDimensionSchema,
  content: z.string().min(1).max(2000),
  evidence: z.string().max(2000).optional(),
  confidence: confidenceSchema.optional(),
});

export const createHypothesisSchema = z.object({
  statement: z.string().min(1).max(2000),
  dimension: cognitiveDimensionSchema.optional(),
  confidence: confidenceSchema.optional(),
});

export const updateHypothesisSchema = z.object({
  status: hypothesisStatusSchema,
  confidence: confidenceSchema.optional(),
});

export const researchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  opportunityId: z.string().optional(),
  /** The objective this lookup is being run in pursuit of, so the finding is
   *  retrievable later as that objective's own evidence. Ownership is
   *  re-checked service-side; an id that isn't the caller's is dropped. */
  objectiveId: z.string().optional(),
});

export const createKnowledgeNodeSchema = z.object({
  label: z.string().min(1).max(200),
  type: knowledgeNodeTypeSchema.optional(),
  description: z.string().max(2000).optional(),
});

export const createKnowledgeConnectionSchema = z.object({
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  relation: z.string().min(1).max(100),
});

export const linkableEntityTypeSchema = z.enum([
  "MEMORY",
  "PROJECT",
  "GOAL",
  "TASK",
  "DECISION",
  "IDEA",
  "EXPERIMENT",
  "RESEARCH_ITEM",
]);

export const linkEntitySchema = z.object({
  entityType: linkableEntityTypeSchema,
  entityId: z.string().min(1),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const grantPermissionSchema = z.object({
  capability: z.string().min(1).max(200),
  level: capabilityLevelSchema,
});

export const revokePermissionSchema = z.object({
  capability: z.string().min(1).max(200),
});

export const connectionServiceSchema = z.enum([
  "GOOGLE_CALENDAR",
  "GOOGLE_GMAIL",
  "NOTION",
  "TODOIST",
  "CRAFT",
  "QUICKBOOKS",
  "PLAID",
  "APPLE_HEALTH",
  "GOOGLE_FIT",
  "GOOGLE_MAPS",
  "AMAZON_ORDERS",
  "ETSY",
  "PRINTFUL",
  "PRINTIFY",
]);

export const suggestConnectionSchema = z.object({
  service: connectionServiceSchema,
  reason: z.string().max(2000).optional(),
});

export const grantConnectionAccessSchema = z.object({
  read: z.boolean().optional(),
  write: z.boolean().optional(),
});

export const startAgentRunSchema = z.object({
  objective: z.string().min(1).max(2000),
  projectId: z.string().optional(),
  agentId: z.string().optional(),
});

export const agentStatusSchema = z.enum(["DRAFT", "READY", "ARCHIVED"]);

export const startSupervisorRunSchema = z.object({
  objectiveId: z.string().min(1),
  maxIterations: z.number().int().min(0).max(5).optional(),
});

export const autonomyModeSchema = z.enum(["MANUAL", "SUPERVISED", "AUTONOMOUS", "AUTONOMOUS_APPROVAL_GATES"]);

export const updateAutonomySchema = z.object({
  autonomyMode: autonomyModeSchema.optional(),
  maxAutonomousSpendUsd: z.coerce.number().min(0).max(1_000_000).optional(),
}).refine((v) => v.autonomyMode !== undefined || v.maxAutonomousSpendUsd !== undefined, {
  message: "At least one of autonomyMode or maxAutonomousSpendUsd is required.",
});

export const createValidationObjectiveSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(4000).optional(),
  allowedCapabilities: z.array(z.string().min(1)).max(50).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(4000).optional(),
  status: agentStatusSchema.optional(),
  allowedCapabilities: z.array(z.string().min(1)).max(50).optional(),
});

export const objectiveStatusSchema = z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED"]);
export const opportunityStatusSchema = z.enum([
  "IDEA",
  "DISCOVERED",
  "RESEARCHING",
  "EVALUATING",
  "WATCHLIST",
  "APPROVED",
  "PLANNING",
  "EXECUTING",
  "VALIDATING",
  "ACTIVE",
  "PAUSED",
  "FAILED",
  "COMPLETED",
  "REJECTED",
]);

export const evidenceItemSchema = z.object({
  type: z.enum(["FACT", "SOURCED", "ESTIMATE", "ASSUMPTION", "UNKNOWN"]),
  text: z.string().min(1).max(1000),
});
export const effortLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const createObjectiveSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  strategy: z.string().max(10_000).optional(),
  assumptions: z.array(z.string().min(1).max(500)).max(20).optional(),
  successCriteria: z.array(z.string().min(1).max(500)).max(20).optional(),
  targetValue: z.coerce.number().optional(),
  targetUnit: z.string().max(20).optional(),
  targetDate: z.coerce.date().optional(),
  status: objectiveStatusSchema.optional(),
});

export const updateObjectiveSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  strategy: z.string().max(10_000).optional(),
  assumptions: z.array(z.string().min(1).max(500)).max(20).optional(),
  successCriteria: z.array(z.string().min(1).max(500)).max(20).optional(),
  targetValue: z.coerce.number().nullable().optional(),
  targetUnit: z.string().max(20).nullable().optional(),
  currentValue: z.coerce.number().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  status: objectiveStatusSchema.optional(),
});

export const createOpportunitySchema = z.object({
  objectiveId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  estimatedValue: z.coerce.number().optional(),
  effort: effortLevelSchema.optional(),
  confidence: confidenceSchema.optional(),
  risk: riskLevelSchema.optional(),
  nextAction: z.string().max(2000).optional(),
  evidence: z.array(evidenceItemSchema).max(20).optional(),
  status: opportunityStatusSchema.optional(),
  category: z.string().max(80).optional(),
  source: z.string().max(120).optional(),
  estimatedStartupCost: z.coerce.number().min(0).optional(),
  estimatedOperatingCost: z.coerce.number().min(0).optional(),
  estimatedMargin: z.coerce.number().min(0).max(1).optional(),
  estimatedTimeToRevenueDays: z.coerce.number().int().min(0).optional(),
  complexity: riskLevelSchema.optional(),
  competition: riskLevelSchema.optional(),
  scalability: riskLevelSchema.optional(),
  requiredHumanInvolvement: riskLevelSchema.optional(),
  requiredCapabilities: z.array(z.string().min(1).max(80)).max(20).optional(),
  dependencies: z.array(z.string().min(1).max(300)).max(20).optional(),
  rationale: z.string().max(3000).optional(),
});

export const promoteOpportunitySchema = z.object({
  projectName: z.string().min(1).max(200).optional(),
});

export const economicAssetCategorySchema = z.enum([
  "MICRO_SAAS",
  "DIGITAL_PRODUCT",
  "CONTENT_ASSET",
  "WEBSITE",
  "AFFILIATE_ASSET",
  "LEAD_GENERATION",
  "API_PRODUCT",
  "AUTOMATION_SERVICE",
  "LICENSED_SOFTWARE",
  "OTHER",
]);
export const economicAssetStatusSchema = z.enum(["IDEA", "BUILDING", "LAUNCHED", "OPERATING", "PAUSED", "RETIRED"]);

export const createEconomicAssetSchema = z.object({
  opportunityId: z.string().min(1).optional(),
  name: z.string().min(1).max(160),
  category: economicAssetCategorySchema,
  status: economicAssetStatusSchema.optional(),
  description: z.string().max(5000).optional(),
});

export const updateEconomicAssetSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  category: economicAssetCategorySchema.optional(),
  status: economicAssetStatusSchema.optional(),
  description: z.string().max(5000).optional(),
});

export const addEconomicLedgerEntrySchema = z.object({
  amountUsd: z.coerce.number().min(0),
  source: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  occurredAt: z.coerce.date(),
  notes: z.string().max(2000).optional(),
});

export const createBrainGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  memberIds: z.array(z.string().min(1)).min(1).max(200),
  color: z.string().max(40).optional(),
});

export const updateBrainGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  memberIds: z.array(z.string().min(1)).max(200).optional(),
  color: z.string().max(40).nullable().optional(),
  collapsed: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const saveBrainViewSchema = z.object({
  name: z.string().min(1).max(120),
  state: z.record(z.string(), z.unknown()),
});

export const updateOpportunitySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  estimatedValue: z.coerce.number().nullable().optional(),
  effort: effortLevelSchema.nullable().optional(),
  confidence: confidenceSchema.optional(),
  risk: riskLevelSchema.nullable().optional(),
  nextAction: z.string().max(2000).nullable().optional(),
  evidence: z.array(evidenceItemSchema).max(20).nullable().optional(),
  status: opportunityStatusSchema.optional(),
  category: z.string().max(80).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  estimatedStartupCost: z.coerce.number().min(0).nullable().optional(),
  estimatedOperatingCost: z.coerce.number().min(0).nullable().optional(),
  estimatedMargin: z.coerce.number().min(0).max(1).nullable().optional(),
  estimatedTimeToRevenueDays: z.coerce.number().int().min(0).nullable().optional(),
  complexity: riskLevelSchema.nullable().optional(),
  competition: riskLevelSchema.nullable().optional(),
  scalability: riskLevelSchema.nullable().optional(),
  requiredHumanInvolvement: riskLevelSchema.nullable().optional(),
  requiredCapabilities: z.array(z.string().min(1).max(80)).max(20).nullable().optional(),
  dependencies: z.array(z.string().min(1).max(300)).max(20).nullable().optional(),
  rationale: z.string().max(3000).nullable().optional(),
});

export const notificationPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);

export const updateNotificationPreferenceSchema = z.object({
  enabled: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  minPriority: notificationPrioritySchema.optional(),
});
