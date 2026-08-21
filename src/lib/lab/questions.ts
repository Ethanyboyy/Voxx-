import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence, LabPriority, LabSubsystem } from "@/generated/prisma/enums";

export interface CreateQuestionInput {
  userId: string;
  suitId?: string;
  question: string;
  importance?: LabPriority;
  subsystem?: LabSubsystem;
  researchStatus?: string;
  currentHypothesis?: string;
  confidence?: LabConfidence;
  nextAction?: string;
}

export async function createQuestion(input: CreateQuestionInput) {
  const question = await db.labEngineeringQuestion.create({
    data: {
      userId: input.userId,
      suitId: input.suitId,
      question: input.question,
      importance: input.importance ?? "MEDIUM",
      subsystem: input.subsystem,
      researchStatus: input.researchStatus,
      currentHypothesis: input.currentHypothesis,
      confidence: input.confidence ?? "HYPOTHETICAL",
      nextAction: input.nextAction,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.question.created",
    payload: { question: question.question, suitId: question.suitId },
    subjectType: "LabEngineeringQuestion",
    subjectId: question.id,
  });

  return question;
}

export async function listQuestions(userId: string, suitId?: string, resolved?: boolean) {
  return db.labEngineeringQuestion.findMany({
    where: { userId, suitId, resolved },
    orderBy: [{ resolved: "asc" }, { importance: "desc" }, { createdAt: "desc" }],
  });
}

export async function getQuestion(userId: string, id: string) {
  return db.labEngineeringQuestion.findFirst({ where: { id, userId }, include: { suit: true } });
}

export interface UpdateQuestionInput {
  question?: string;
  importance?: LabPriority;
  subsystem?: LabSubsystem | null;
  researchStatus?: string;
  currentHypothesis?: string;
  confidence?: LabConfidence;
  nextAction?: string;
  resolved?: boolean;
  answer?: string;
}

export async function updateQuestion(userId: string, id: string, updates: UpdateQuestionInput) {
  const existing = await db.labEngineeringQuestion.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const resolving = updates.resolved === true && !existing.resolved;
  const question = await db.labEngineeringQuestion.update({
    where: { id },
    data: { ...updates, resolvedAt: resolving ? new Date() : existing.resolvedAt },
  });

  if (resolving) {
    await recordEvent({
      userId,
      type: "lab.question.resolved",
      payload: { question: question.question, answer: question.answer },
      subjectType: "LabEngineeringQuestion",
      subjectId: id,
    });
  }

  return question;
}

export async function deleteQuestion(userId: string, id: string) {
  const existing = await db.labEngineeringQuestion.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.labEngineeringQuestion.delete({ where: { id } });
  return true;
}
