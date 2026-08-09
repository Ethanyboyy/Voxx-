import { db } from "@/lib/db";
import type { CognitiveDimension, Confidence, HypothesisStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Observations — atomic, evidence-linked notes about behavior.
// ---------------------------------------------------------------------------

export interface CreateObservationInput {
  userId: string;
  dimension: CognitiveDimension;
  content: string;
  evidence?: string;
  confidence?: Confidence;
}

export async function createObservation(input: CreateObservationInput) {
  return db.observation.create({
    data: {
      userId: input.userId,
      dimension: input.dimension,
      content: input.content,
      evidence: input.evidence,
      confidence: input.confidence ?? "LOW",
    },
  });
}

export async function listObservations(userId: string, dimension?: CognitiveDimension, limit = 100) {
  return db.observation.findMany({
    where: { userId, dimension },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Hypotheses — explicit, revisable claims derived from observations. Never
// silently promoted to fact.
// ---------------------------------------------------------------------------

export interface CreateHypothesisInput {
  userId: string;
  statement: string;
  dimension?: CognitiveDimension;
  confidence?: Confidence;
}

export async function createHypothesis(input: CreateHypothesisInput) {
  return db.hypothesis.create({
    data: {
      userId: input.userId,
      statement: input.statement,
      dimension: input.dimension,
      confidence: input.confidence ?? "LOW",
      status: "OPEN",
    },
  });
}

export async function listHypotheses(userId: string, status?: HypothesisStatus) {
  return db.hypothesis.findMany({ where: { userId, status }, orderBy: { updatedAt: "desc" } });
}

export async function updateHypothesisStatus(
  userId: string,
  id: string,
  status: HypothesisStatus,
  confidence?: Confidence
) {
  const existing = await db.hypothesis.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.hypothesis.update({ where: { id }, data: { status, confidence } });
}
