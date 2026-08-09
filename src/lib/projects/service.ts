import { db } from "@/lib/db";
import type {
  DecisionStatus,
  ExperimentStatus,
  GoalStatus,
  IdeaStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  userId: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
}

export async function createProject(input: CreateProjectInput) {
  return db.project.create({
    data: {
      userId: input.userId,
      name: input.name,
      description: input.description,
      status: input.status ?? "ACTIVE",
    },
  });
}

export async function listProjects(userId: string, status?: ProjectStatus) {
  return db.project.findMany({
    where: { userId, status },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProject(userId: string, id: string) {
  return db.project.findFirst({
    where: { id, userId },
    include: { goals: true, tasks: true, decisions: true, ideas: true, experiments: true },
  });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

export async function updateProject(userId: string, id: string, updates: UpdateProjectInput) {
  const existing = await db.project.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.project.update({ where: { id }, data: updates });
}

export async function deleteProject(userId: string, id: string) {
  const existing = await db.project.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.project.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface CreateGoalInput {
  userId: string;
  projectId?: string;
  title: string;
  description?: string;
  status?: GoalStatus;
  targetDate?: Date;
}

export async function createGoal(input: CreateGoalInput) {
  return db.goal.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? "ACTIVE",
      targetDate: input.targetDate,
    },
  });
}

export async function listGoals(userId: string, projectId?: string) {
  return db.goal.findMany({ where: { userId, projectId }, orderBy: { createdAt: "desc" } });
}

export async function updateGoal(
  userId: string,
  id: string,
  updates: Partial<Pick<CreateGoalInput, "title" | "description" | "status" | "targetDate">>
) {
  const existing = await db.goal.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.goal.update({ where: { id }, data: updates });
}

export async function deleteGoal(userId: string, id: string) {
  const existing = await db.goal.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.goal.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  userId: string;
  projectId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date;
}

export async function createTask(input: CreateTaskInput) {
  return db.task.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? "TODO",
      priority: input.priority ?? "MEDIUM",
      dueDate: input.dueDate,
    },
  });
}

export async function listTasks(userId: string, projectId?: string, status?: TaskStatus) {
  return db.task.findMany({
    where: { userId, projectId, status },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date | null;
}

export async function updateTask(userId: string, id: string, updates: UpdateTaskInput) {
  const existing = await db.task.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.task.update({
    where: { id },
    data: {
      ...updates,
      completedAt: updates.status === "DONE" ? new Date() : updates.status ? null : undefined,
    },
  });
}

export async function deleteTask(userId: string, id: string) {
  const existing = await db.task.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.task.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface CreateDecisionInput {
  userId: string;
  projectId?: string;
  title: string;
  description?: string;
  alternatives?: string[];
  chosenOption?: string;
  status?: DecisionStatus;
}

export async function createDecision(input: CreateDecisionInput) {
  return db.decision.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      alternatives: input.alternatives ? JSON.stringify(input.alternatives) : undefined,
      chosenOption: input.chosenOption,
      status: input.status ?? "PENDING",
      decidedAt: input.status === "DECIDED" ? new Date() : undefined,
    },
  });
}

export async function listDecisions(userId: string, projectId?: string) {
  return db.decision.findMany({ where: { userId, projectId }, orderBy: { createdAt: "desc" } });
}

export async function updateDecision(
  userId: string,
  id: string,
  updates: Partial<{ title: string; description: string; chosenOption: string; status: DecisionStatus }>
) {
  const existing = await db.decision.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.decision.update({
    where: { id },
    data: {
      ...updates,
      decidedAt: updates.status === "DECIDED" ? new Date() : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

export interface CreateIdeaInput {
  userId: string;
  projectId?: string;
  title: string;
  description?: string;
  status?: IdeaStatus;
}

export async function createIdea(input: CreateIdeaInput) {
  return db.idea.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? "CAPTURED",
    },
  });
}

export async function listIdeas(userId: string, projectId?: string) {
  return db.idea.findMany({ where: { userId, projectId }, orderBy: { createdAt: "desc" } });
}

export async function updateIdea(
  userId: string,
  id: string,
  updates: Partial<{ title: string; description: string; status: IdeaStatus }>
) {
  const existing = await db.idea.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.idea.update({ where: { id }, data: updates });
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export interface CreateExperimentInput {
  userId: string;
  projectId?: string;
  ideaId?: string;
  hypothesis: string;
  method?: string;
  status?: ExperimentStatus;
}

export async function createExperiment(input: CreateExperimentInput) {
  return db.experiment.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      ideaId: input.ideaId,
      hypothesis: input.hypothesis,
      method: input.method,
      status: input.status ?? "PLANNED",
      startedAt: input.status === "RUNNING" ? new Date() : undefined,
    },
  });
}

export async function listExperiments(userId: string, projectId?: string) {
  return db.experiment.findMany({
    where: { userId, projectId },
    include: { results: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateExperiment(
  userId: string,
  id: string,
  updates: Partial<{ hypothesis: string; method: string; status: ExperimentStatus }>
) {
  const existing = await db.experiment.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.experiment.update({
    where: { id },
    data: {
      ...updates,
      startedAt: updates.status === "RUNNING" ? new Date() : undefined,
      endedAt: updates.status === "COMPLETED" || updates.status === "ABANDONED" ? new Date() : undefined,
    },
  });
}

export interface AddExperimentResultInput {
  experimentId: string;
  outcome: string;
  learnings?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED";
}

export async function addExperimentResult(userId: string, input: AddExperimentResultInput) {
  const experiment = await db.experiment.findFirst({ where: { id: input.experimentId, userId } });
  if (!experiment) return null;
  return db.experimentResult.create({
    data: {
      experimentId: input.experimentId,
      outcome: input.outcome,
      learnings: input.learnings,
      confidence: input.confidence ?? "MEDIUM",
    },
  });
}
