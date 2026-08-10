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
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.coerce.date().nullable().optional(),
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
