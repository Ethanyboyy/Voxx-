import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence } from "@/generated/prisma/enums";

export interface CreateDecisionInput {
  userId: string;
  suitId?: string;
  decision: string;
  context?: string;
  options?: string[];
  selectedOption?: string;
  rationale?: string;
  evidence?: string;
  tradeoffs?: string;
  author?: string;
  confidence?: LabConfidence;
}

/** Permanent project memory — never updated or deleted; a later reversal is
 * its own new decision row, so the history stays intact (see the model's
 * doc comment in schema.prisma). No update/delete function exists here on
 * purpose. */
export async function createDecision(input: CreateDecisionInput) {
  const decision = await db.labDecision.create({
    data: {
      userId: input.userId,
      suitId: input.suitId,
      decision: input.decision,
      context: input.context,
      options: input.options ? JSON.stringify(input.options) : undefined,
      selectedOption: input.selectedOption,
      rationale: input.rationale,
      evidence: input.evidence,
      tradeoffs: input.tradeoffs,
      author: input.author ?? "user",
      confidence: input.confidence ?? "ESTIMATED",
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.decision.recorded",
    payload: { decision: decision.decision, selectedOption: decision.selectedOption, suitId: decision.suitId },
    subjectType: "LabDecision",
    subjectId: decision.id,
  });

  return decision;
}

export async function listDecisions(userId: string, suitId?: string) {
  return db.labDecision.findMany({ where: { userId, suitId }, orderBy: { createdAt: "desc" } });
}

export async function getDecision(userId: string, id: string) {
  return db.labDecision.findFirst({ where: { id, userId } });
}
