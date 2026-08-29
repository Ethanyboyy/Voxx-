import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { recordExperimentResultExperience } from "@/lib/lab/learning";
import { scopeObjectiveId } from "@/lib/cognition/experience";
import type { LabConfidence, LabExperimentStatus } from "@/generated/prisma/enums";

export interface CreateExperimentInput {
  userId: string;
  projectId?: string;
  code: string;
  title: string;
  hypothesis: string;
  objective?: string;
  variables?: { name: string; value: string; unit?: string }[];
  equipmentNotes?: string;
  environmentNotes?: string;
  expectedOutcome?: string;
  suitId?: string;
  /// Optional: the specific component this experiment targets, rather than
  /// "the suit generally" — see LabComponent.
  componentId?: string;
  simulationRunId?: string;
  confidence?: LabConfidence;
  /** The Objective this experiment is being run in pursuit of. Distinct from
   *  `objective` above, which is this experiment's own free-text aim. */
  objectiveId?: string;
}

export async function createExperiment(input: CreateExperimentInput) {
  const experiment = await db.labExperiment.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      code: input.code,
      title: input.title,
      hypothesis: input.hypothesis,
      objective: input.objective,
      variables: input.variables ? JSON.stringify(input.variables) : undefined,
      equipmentNotes: input.equipmentNotes,
      environmentNotes: input.environmentNotes,
      expectedOutcome: input.expectedOutcome,
      suitId: input.suitId,
      componentId: input.componentId,
      simulationRunId: input.simulationRunId,
      confidence: input.confidence ?? "HYPOTHETICAL",
      // Recorded on the experiment itself, so the objective association
      // survives even if the derived graph write later fails.
      objectiveId: await scopeObjectiveId(input.userId, input.objectiveId),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.experiment.created",
    payload: { code: experiment.code, title: experiment.title, objectiveId: experiment.objectiveId },
    subjectType: "LabExperiment",
    subjectId: experiment.id,
  });

  return experiment;
}

export async function listExperiments(userId: string, status?: LabExperimentStatus) {
  return db.labExperiment.findMany({
    where: { userId, status },
    include: { suit: true, results: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getExperiment(userId: string, id: string) {
  return db.labExperiment.findFirst({
    where: { id, userId },
    include: {
      suit: { include: { currentVersion: { include: { stats: true } } } },
      simulationRun: true,
      results: { orderBy: { createdAt: "desc" } },
      project: true,
    },
  });
}

export interface UpdateExperimentInput {
  status?: LabExperimentStatus;
  nextIteration?: string;
  expectedOutcome?: string;
}

export async function updateExperiment(userId: string, id: string, updates: UpdateExperimentInput) {
  const existing = await db.labExperiment.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const experiment = await db.labExperiment.update({ where: { id }, data: updates });

  if (updates.status === "FAILED") {
    await recordEvent({
      userId,
      type: "lab.experiment.failed",
      payload: { code: experiment.code, title: experiment.title },
      subjectType: "LabExperiment",
      subjectId: id,
    });
  } else if (updates.status === "COMPLETED") {
    await recordEvent({
      userId,
      type: "lab.experiment.completed",
      payload: { code: experiment.code, title: experiment.title },
      subjectType: "LabExperiment",
      subjectId: id,
    });
  }
  return experiment;
}

export interface AddExperimentResultInput {
  outcome: string;
  learnings?: string;
  confidence?: LabConfidence;
}

export async function addExperimentResult(userId: string, experimentId: string, input: AddExperimentResultInput) {
  const experiment = await db.labExperiment.findFirst({ where: { id: experimentId, userId } });
  if (!experiment) return null;

  const confidence = input.confidence ?? "ESTIMATED";
  const result = await db.labExperimentResult.create({
    data: {
      experimentId,
      outcome: input.outcome,
      learnings: input.learnings,
      confidence,
    },
  });

  // Recording a result used to end here — the row existed and nothing else in
  // VOX ever heard about it, not even the event log. The experiment's
  // hypothesis, configuration, expected outcome and actual outcome are now
  // written into memory and the graph, so what the Lab found is available to
  // every later planning pass instead of only to whoever opens this page.
  await recordExperimentResultExperience({
    userId,
    experimentId,
    code: experiment.code,
    title: experiment.title,
    hypothesis: experiment.hypothesis,
    variablesJson: experiment.variables,
    expectedOutcome: experiment.expectedOutcome,
    outcome: input.outcome,
    learnings: input.learnings ?? null,
    confidence,
    // Read from the experiment rather than taken from the caller: the
    // objective was decided when the experiment was created, and a result
    // must not be able to re-point itself at a different goal.
    objectiveId: experiment.objectiveId,
  });

  return result;
}

export async function nextExperimentCode(userId: string) {
  const count = await db.labExperiment.count({ where: { userId } });
  return `EXP-${String(count + 1).padStart(3, "0")}`;
}
