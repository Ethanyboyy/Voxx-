import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type {
  Confidence,
  EffortLevel,
  ObjectiveStatus,
  OpportunityStatus,
  RiskLevel,
} from "@/generated/prisma/enums";
import type { Objective, Opportunity } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export interface ObjectiveDTO {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  strategy: string | null;
  assumptions: string[];
  targetValue: number | null;
  targetUnit: string | null;
  currentValue: number | null;
  targetDate: Date | null;
  status: ObjectiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toObjectiveDTO(row: Objective): ObjectiveDTO {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description,
    strategy: row.strategy,
    assumptions: parseStringArray(row.assumptions),
    targetValue: row.targetValue,
    targetUnit: row.targetUnit,
    currentValue: row.currentValue,
    targetDate: row.targetDate,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateObjectiveInput {
  userId: string;
  title: string;
  description?: string;
  strategy?: string;
  assumptions?: string[];
  targetValue?: number;
  targetUnit?: string;
  targetDate?: Date;
  status?: ObjectiveStatus;
}

export async function createObjective(input: CreateObjectiveInput): Promise<ObjectiveDTO> {
  const row = await db.objective.create({
    data: {
      userId: input.userId,
      title: input.title,
      description: input.description,
      strategy: input.strategy,
      assumptions: input.assumptions ? JSON.stringify(input.assumptions) : undefined,
      targetValue: input.targetValue,
      targetUnit: input.targetUnit,
      targetDate: input.targetDate,
      status: input.status ?? "ACTIVE",
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "objective.created",
    subjectType: "Objective",
    subjectId: row.id,
    payload: { title: row.title },
  });

  return toObjectiveDTO(row);
}

export async function listObjectives(userId: string, status?: ObjectiveStatus): Promise<ObjectiveDTO[]> {
  const rows = await db.objective.findMany({ where: { userId, status }, orderBy: { updatedAt: "desc" } });
  return rows.map(toObjectiveDTO);
}

/** The objective VOX currently treats as "what I'm helping with" — most recently touched ACTIVE objective, or null. Never invented when none exists. */
export async function getActiveObjective(userId: string): Promise<ObjectiveDTO | null> {
  const row = await db.objective.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
  return row ? toObjectiveDTO(row) : null;
}

export interface ObjectiveWithOpportunitiesDTO extends ObjectiveDTO {
  opportunities: OpportunityDTO[];
}

export async function getObjective(userId: string, id: string): Promise<ObjectiveWithOpportunitiesDTO | null> {
  const row = await db.objective.findFirst({
    where: { id, userId },
    include: { opportunities: { orderBy: { updatedAt: "desc" } } },
  });
  if (!row) return null;
  return { ...toObjectiveDTO(row), opportunities: row.opportunities.map(toOpportunityDTO) };
}

export interface UpdateObjectiveInput {
  title?: string;
  description?: string;
  strategy?: string;
  assumptions?: string[];
  targetValue?: number | null;
  targetUnit?: string | null;
  /** Only ever set from explicit user input — VOX never auto-increments this. */
  currentValue?: number | null;
  targetDate?: Date | null;
  status?: ObjectiveStatus;
}

export async function updateObjective(
  userId: string,
  id: string,
  updates: UpdateObjectiveInput
): Promise<ObjectiveDTO | null> {
  const existing = await db.objective.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const row = await db.objective.update({
    where: { id },
    data: {
      ...updates,
      assumptions: updates.assumptions === undefined ? undefined : JSON.stringify(updates.assumptions),
    },
  });

  if (updates.status && updates.status !== existing.status) {
    await recordEvent({
      userId,
      type: updates.status === "ACHIEVED" ? "objective.achieved" : "objective.status_changed",
      subjectType: "Objective",
      subjectId: id,
      payload: { from: existing.status, to: updates.status },
    });
  }
  if (updates.currentValue !== undefined && updates.currentValue !== existing.currentValue) {
    await recordEvent({
      userId,
      type: "objective.progress_updated",
      subjectType: "Objective",
      subjectId: id,
      payload: { from: existing.currentValue, to: updates.currentValue, targetValue: row.targetValue },
    });
  }

  return toObjectiveDTO(row);
}

export async function deleteObjective(userId: string, id: string): Promise<boolean> {
  const existing = await db.objective.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.objective.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export interface OpportunityDTO {
  id: string;
  userId: string;
  objectiveId: string;
  title: string;
  description: string | null;
  estimatedValue: number | null;
  effort: EffortLevel | null;
  confidence: Confidence;
  risk: RiskLevel | null;
  nextAction: string | null;
  evidence: string[];
  status: OpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toOpportunityDTO(row: Opportunity): OpportunityDTO {
  return {
    id: row.id,
    userId: row.userId,
    objectiveId: row.objectiveId,
    title: row.title,
    description: row.description,
    estimatedValue: row.estimatedValue,
    effort: row.effort,
    confidence: row.confidence,
    risk: row.risk,
    nextAction: row.nextAction,
    evidence: parseStringArray(row.evidence),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateOpportunityInput {
  userId: string;
  objectiveId: string;
  title: string;
  description?: string;
  estimatedValue?: number;
  effort?: EffortLevel;
  confidence?: Confidence;
  risk?: RiskLevel;
  nextAction?: string;
  evidence?: string[];
  status?: OpportunityStatus;
}

export async function createOpportunity(input: CreateOpportunityInput): Promise<OpportunityDTO | null> {
  const objective = await db.objective.findFirst({ where: { id: input.objectiveId, userId: input.userId } });
  if (!objective) return null;

  const row = await db.opportunity.create({
    data: {
      userId: input.userId,
      objectiveId: input.objectiveId,
      title: input.title,
      description: input.description,
      estimatedValue: input.estimatedValue,
      effort: input.effort,
      confidence: input.confidence ?? "LOW",
      risk: input.risk,
      nextAction: input.nextAction,
      evidence: input.evidence ? JSON.stringify(input.evidence) : undefined,
      status: input.status ?? "IDEA",
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "opportunity.created",
    subjectType: "Opportunity",
    subjectId: row.id,
    payload: { title: row.title, objectiveId: input.objectiveId },
  });

  return toOpportunityDTO(row);
}

export async function listOpportunities(userId: string, objectiveId?: string): Promise<OpportunityDTO[]> {
  const rows = await db.opportunity.findMany({ where: { userId, objectiveId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toOpportunityDTO);
}

export interface UpdateOpportunityInput {
  title?: string;
  description?: string;
  estimatedValue?: number | null;
  effort?: EffortLevel | null;
  confidence?: Confidence;
  risk?: RiskLevel | null;
  nextAction?: string | null;
  evidence?: string[] | null;
  status?: OpportunityStatus;
}

export async function updateOpportunity(
  userId: string,
  id: string,
  updates: UpdateOpportunityInput
): Promise<OpportunityDTO | null> {
  const existing = await db.opportunity.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const row = await db.opportunity.update({
    where: { id },
    data: {
      ...updates,
      evidence: updates.evidence === undefined ? undefined : updates.evidence === null ? null : JSON.stringify(updates.evidence),
    },
  });

  if (updates.status && updates.status !== existing.status) {
    await recordEvent({
      userId,
      type: "opportunity.status_changed",
      subjectType: "Opportunity",
      subjectId: id,
      payload: { from: existing.status, to: updates.status },
    });
  }

  return toOpportunityDTO(row);
}

export async function deleteOpportunity(userId: string, id: string): Promise<boolean> {
  const existing = await db.opportunity.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.opportunity.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Next best action — an honest ranking of the user's own data, never a
// fabricated suggestion. Nothing here invents an opportunity or an action;
// it only surfaces what's already recorded, ranked by a transparent formula.
// ---------------------------------------------------------------------------

const EFFORT_WEIGHT: Record<EffortLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const RISK_PENALTY: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0.15, HIGH: 0.35 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { LOW: 0.5, MEDIUM: 0.75, HIGH: 1, CONFIRMED: 1.15 };

/**
 * Score = (estimatedValue, or 1 if unset so effort/confidence still rank it)
 *         / effort weight
 *         * confidence weight
 *         * (1 - risk penalty)
 * Purely a re-ranking of numbers the user already entered — never generates
 * a value that wasn't already on the row.
 */
function scoreOpportunity(o: OpportunityDTO): number {
  const value = o.estimatedValue ?? 1;
  const effortWeight = o.effort ? EFFORT_WEIGHT[o.effort] : 2;
  const riskPenalty = o.risk ? RISK_PENALTY[o.risk] : 0.15;
  const confidenceWeight = CONFIDENCE_WEIGHT[o.confidence];
  return (value / effortWeight) * confidenceWeight * (1 - riskPenalty);
}

export interface NextBestAction {
  objective: ObjectiveDTO;
  opportunity: OpportunityDTO | null;
  action: string | null;
}

export async function getNextBestAction(userId: string): Promise<NextBestAction | null> {
  const objective = await getActiveObjective(userId);
  if (!objective) return null;

  const candidates = (await listOpportunities(userId, objective.id)).filter(
    (o) => o.status === "ACTIVE" || o.status === "EVALUATING" || o.status === "IDEA"
  );

  if (candidates.length === 0) {
    return { objective, opportunity: null, action: null };
  }

  const ranked = [...candidates].sort((a, b) => scoreOpportunity(b) - scoreOpportunity(a));
  const top = ranked[0];
  return {
    objective,
    opportunity: top,
    action: top.nextAction ?? null,
  };
}
