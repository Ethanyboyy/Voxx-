import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { createProject } from "@/lib/projects/service";
import type {
  Confidence,
  EffortLevel,
  ObjectiveStatus,
  OpportunityStatus,
  RiskLevel,
} from "@/generated/prisma/enums";
import type { Objective, Opportunity, Project } from "@/generated/prisma/client";

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
  /// Set when this Objective was created to validate/pursue an Opportunity
  /// (Economic Engine) — see createValidationObjective() below.
  sourceOpportunityId: string | null;
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
    sourceOpportunityId: row.sourceOpportunityId,
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

/** Evidence-item provenance — every claim behind an opportunity's numbers
 * must say which of these it is. Never blended into unlabeled prose. */
export type EvidenceType = "FACT" | "SOURCED" | "ESTIMATE" | "ASSUMPTION" | "UNKNOWN";
export interface EvidenceItem {
  type: EvidenceType;
  text: string;
}

function parseEvidence(raw: string | null): EvidenceItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Back-compat: earlier rows may hold plain strings — treat those as UNKNOWN provenance.
    return parsed.map((item) =>
      typeof item === "string"
        ? { type: "UNKNOWN" as EvidenceType, text: item }
        : { type: (item.type as EvidenceType) ?? "UNKNOWN", text: String(item.text ?? "") }
    );
  } catch {
    return [];
  }
}

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
  evidence: EvidenceItem[];
  status: OpportunityStatus;
  /// Set once this opportunity has been promoted into a real Project.
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;

  // --- Economic Engine: structured opportunity intelligence ---
  category: string | null;
  source: string | null;
  discoveredAt: Date;
  estimatedStartupCost: number | null;
  estimatedOperatingCost: number | null;
  estimatedMargin: number | null;
  estimatedTimeToRevenueDays: number | null;
  complexity: RiskLevel | null;
  competition: RiskLevel | null;
  scalability: RiskLevel | null;
  requiredHumanInvolvement: RiskLevel | null;
  requiredCapabilities: string[];
  dependencies: string[];
  rationale: string | null;
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
    evidence: parseEvidence(row.evidence),
    status: row.status,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: row.category,
    source: row.source,
    discoveredAt: row.discoveredAt,
    estimatedStartupCost: row.estimatedStartupCost,
    estimatedOperatingCost: row.estimatedOperatingCost,
    estimatedMargin: row.estimatedMargin,
    estimatedTimeToRevenueDays: row.estimatedTimeToRevenueDays,
    complexity: row.complexity,
    competition: row.competition,
    scalability: row.scalability,
    requiredHumanInvolvement: row.requiredHumanInvolvement,
    requiredCapabilities: parseStringArray(row.requiredCapabilities),
    dependencies: parseStringArray(row.dependencies),
    rationale: row.rationale,
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
  evidence?: EvidenceItem[];
  status?: OpportunityStatus;
  category?: string;
  source?: string;
  estimatedStartupCost?: number;
  estimatedOperatingCost?: number;
  estimatedMargin?: number;
  estimatedTimeToRevenueDays?: number;
  complexity?: RiskLevel;
  competition?: RiskLevel;
  scalability?: RiskLevel;
  requiredHumanInvolvement?: RiskLevel;
  requiredCapabilities?: string[];
  dependencies?: string[];
  rationale?: string;
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
      category: input.category,
      source: input.source,
      estimatedStartupCost: input.estimatedStartupCost,
      estimatedOperatingCost: input.estimatedOperatingCost,
      estimatedMargin: input.estimatedMargin,
      estimatedTimeToRevenueDays: input.estimatedTimeToRevenueDays,
      complexity: input.complexity,
      competition: input.competition,
      scalability: input.scalability,
      requiredHumanInvolvement: input.requiredHumanInvolvement,
      requiredCapabilities: input.requiredCapabilities ? JSON.stringify(input.requiredCapabilities) : undefined,
      dependencies: input.dependencies ? JSON.stringify(input.dependencies) : undefined,
      rationale: input.rationale,
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
  evidence?: EvidenceItem[] | null;
  status?: OpportunityStatus;
  category?: string | null;
  source?: string | null;
  estimatedStartupCost?: number | null;
  estimatedOperatingCost?: number | null;
  estimatedMargin?: number | null;
  estimatedTimeToRevenueDays?: number | null;
  complexity?: RiskLevel | null;
  competition?: RiskLevel | null;
  scalability?: RiskLevel | null;
  requiredHumanInvolvement?: RiskLevel | null;
  requiredCapabilities?: string[] | null;
  dependencies?: string[] | null;
  rationale?: string | null;
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
      requiredCapabilities:
        updates.requiredCapabilities === undefined ? undefined : updates.requiredCapabilities === null ? null : JSON.stringify(updates.requiredCapabilities),
      dependencies:
        updates.dependencies === undefined ? undefined : updates.dependencies === null ? null : JSON.stringify(updates.dependencies),
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
// Promotion — turning an evaluated opportunity into real execution. This is
// the one path that sets Opportunity.projectId, so "promoted" always means a
// real Project row exists, never just a status label.
// ---------------------------------------------------------------------------

export interface PromoteOpportunityResult {
  opportunity: OpportunityDTO;
  project: Project;
  alreadyPromoted: boolean;
}

export async function promoteOpportunityToProject(
  userId: string,
  opportunityId: string,
  projectName?: string
): Promise<PromoteOpportunityResult | null> {
  const existing = await db.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!existing) return null;

  if (existing.projectId) {
    const project = await db.project.findFirst({ where: { id: existing.projectId, userId } });
    if (project) {
      return { opportunity: toOpportunityDTO(existing), project, alreadyPromoted: true };
    }
  }

  const project = await createProject({
    userId,
    name: projectName?.trim() || existing.title,
    description: existing.description ?? undefined,
  });

  const updated = await db.opportunity.update({
    where: { id: opportunityId },
    data: { projectId: project.id, status: existing.status === "IDEA" ? "ACTIVE" : existing.status },
  });

  await recordEvent({
    userId,
    type: "opportunity.promoted_to_project",
    subjectType: "Opportunity",
    subjectId: opportunityId,
    payload: { projectId: project.id, projectName: project.name },
  });

  return { opportunity: toOpportunityDTO(updated), project, alreadyPromoted: false };
}

// ---------------------------------------------------------------------------
// Next best action — an honest ranking of the user's own data, never a
// fabricated suggestion. Nothing here invents an opportunity or an action;
// it only surfaces what's already recorded, ranked by a transparent formula.
// ---------------------------------------------------------------------------

const EFFORT_WEIGHT: Record<EffortLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const RISK_PENALTY: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0.15, HIGH: 0.35 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { LOW: 0.5, MEDIUM: 0.75, HIGH: 1, CONFIRMED: 1.15 };
/// HIGH scalability is a BONUS (multiplies score up), unlike risk/complexity/
/// competition/human-involvement, which are penalties (multiply score down).
const SCALABILITY_BONUS: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0.15, HIGH: 0.35 };

/// Unlike the original `risk` field (which defaults an unset value to a
/// MEDIUM penalty — an established convention this function deliberately
/// does not disturb), these newer Economic Engine factors default to a
/// TRUE neutral (no penalty at all) when unset, so an opportunity with no
/// complexity/competition/human-involvement data scores identically to how
/// it did before these fields existed.
function factorPenalty(level: RiskLevel | null): number {
  return level ? RISK_PENALTY[level] : 0;
}

/**
 * Score = (estimatedValue, or 1 if unset so effort/confidence still rank it)
 *         / effort weight
 *         * confidence weight
 *         * (1 - risk penalty)
 *         / capital divisor          (Economic Engine: startup cost drag)
 *         / operating-cost divisor   (Economic Engine: recurring cost drag)
 *         * margin multiplier        (Economic Engine: 0-1 margin fraction)
 *         * speed multiplier         (Economic Engine: time-to-revenue)
 *         * (1 - complexity penalty)
 *         * (1 - competition penalty)
 *         * (1 + scalability bonus)
 *         * (1 - human-involvement penalty)
 * Every Economic Engine factor defaults to neutral (no change to the score)
 * when the corresponding field is null — an unset field is never treated as
 * zero or as "bad", only as "not yet known". Purely a re-ranking of numbers
 * already on the row; never generates a value that wasn't already there.
 */
export function scoreOpportunity(o: OpportunityDTO): number {
  const value = o.estimatedValue ?? 1;
  const effortWeight = o.effort ? EFFORT_WEIGHT[o.effort] : 2;
  const riskPenalty = o.risk ? RISK_PENALTY[o.risk] : 0.15;
  const confidenceWeight = CONFIDENCE_WEIGHT[o.confidence];

  const capitalDivisor = 1 + (o.estimatedStartupCost ?? 0) / 1000;
  const operatingDivisor = 1 + (o.estimatedOperatingCost ?? 0) / 500;
  const marginMultiplier = o.estimatedMargin == null ? 1 : 0.5 + Math.max(0, Math.min(1, o.estimatedMargin));
  const speedMultiplier =
    o.estimatedTimeToRevenueDays == null ? 1 : Math.max(0.3, Math.min(2, 30 / Math.max(7, o.estimatedTimeToRevenueDays)));
  const complexityPenalty = factorPenalty(o.complexity);
  const competitionPenalty = factorPenalty(o.competition);
  const scalabilityBonus = o.scalability ? SCALABILITY_BONUS[o.scalability] : 0;
  const humanInvolvementPenalty = factorPenalty(o.requiredHumanInvolvement);

  return (
    ((value / effortWeight) * confidenceWeight * (1 - riskPenalty)) /
    capitalDivisor /
    operatingDivisor *
    marginMultiplier *
    speedMultiplier *
    (1 - complexityPenalty) *
    (1 - competitionPenalty) *
    (1 + scalabilityBonus) *
    (1 - humanInvolvementPenalty)
  );
}

export interface OpportunityScoreBreakdown {
  score: number;
  value: number;
  valueIsAssumedDefault: boolean;
  effort: EffortLevel | null;
  effortWeight: number;
  confidence: Confidence;
  confidenceWeight: number;
  risk: RiskLevel | null;
  riskPenalty: number;
  estimatedStartupCost: number | null;
  capitalDivisor: number;
  estimatedOperatingCost: number | null;
  operatingDivisor: number;
  estimatedMargin: number | null;
  marginMultiplier: number;
  estimatedTimeToRevenueDays: number | null;
  speedMultiplier: number;
  complexity: RiskLevel | null;
  complexityPenalty: number;
  competition: RiskLevel | null;
  competitionPenalty: number;
  scalability: RiskLevel | null;
  scalabilityBonus: number;
  requiredHumanInvolvement: RiskLevel | null;
  humanInvolvementPenalty: number;
}

/**
 * The exact same formula and weight tables as scoreOpportunity(), just with
 * every intermediate factor exposed — this is what the Brain's "Why?" panel
 * renders, so the ranking is never a black box. Never recomputes the score
 * differently than scoreOpportunity() does; this is that function with its
 * work shown, so "why did this rank #1" always has a real, decomposable answer.
 */
export function explainOpportunityScore(o: OpportunityDTO): OpportunityScoreBreakdown {
  const effortWeight = o.effort ? EFFORT_WEIGHT[o.effort] : 2;
  const riskPenalty = o.risk ? RISK_PENALTY[o.risk] : 0.15;
  const confidenceWeight = CONFIDENCE_WEIGHT[o.confidence];
  const capitalDivisor = 1 + (o.estimatedStartupCost ?? 0) / 1000;
  const operatingDivisor = 1 + (o.estimatedOperatingCost ?? 0) / 500;
  const marginMultiplier = o.estimatedMargin == null ? 1 : 0.5 + Math.max(0, Math.min(1, o.estimatedMargin));
  const speedMultiplier =
    o.estimatedTimeToRevenueDays == null ? 1 : Math.max(0.3, Math.min(2, 30 / Math.max(7, o.estimatedTimeToRevenueDays)));
  return {
    score: scoreOpportunity(o),
    value: o.estimatedValue ?? 1,
    valueIsAssumedDefault: o.estimatedValue == null,
    effort: o.effort,
    effortWeight,
    confidence: o.confidence,
    confidenceWeight,
    risk: o.risk,
    riskPenalty,
    estimatedStartupCost: o.estimatedStartupCost,
    capitalDivisor,
    estimatedOperatingCost: o.estimatedOperatingCost,
    operatingDivisor,
    estimatedMargin: o.estimatedMargin,
    marginMultiplier,
    estimatedTimeToRevenueDays: o.estimatedTimeToRevenueDays,
    speedMultiplier,
    complexity: o.complexity,
    complexityPenalty: factorPenalty(o.complexity),
    competition: o.competition,
    competitionPenalty: factorPenalty(o.competition),
    scalability: o.scalability,
    scalabilityBonus: o.scalability ? SCALABILITY_BONUS[o.scalability] : 0,
    requiredHumanInvolvement: o.requiredHumanInvolvement,
    humanInvolvementPenalty: factorPenalty(o.requiredHumanInvolvement),
  };
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

// ---------------------------------------------------------------------------
// Economic Engine: Opportunity -> Objective bridge. Creates the Objective a
// SupervisorRun will actually work against, WITHOUT creating a second
// execution engine — the existing Supervisor/Agent infrastructure remains
// the only thing that ever executes anything.
// ---------------------------------------------------------------------------

export interface CreateValidationObjectiveInput {
  userId: string;
  opportunityId: string;
  /** Free text — defaults to a generic "validate this can work" framing if omitted. */
  title?: string;
  description?: string;
}

export interface CreateValidationObjectiveResult {
  objective: ObjectiveDTO;
  opportunity: OpportunityDTO;
}

/** Turns an Opportunity into a real Objective the Supervisor can pursue —
 * e.g. "Potential local lead-generation service" becomes "Validate whether
 * this opportunity can acquire its first paying customer within budget."
 * Advances the opportunity's pipeline status to PLANNING (unless it's
 * already further along) so the pipeline stays honest about what's
 * actually being worked. */
export async function createValidationObjective(
  input: CreateValidationObjectiveInput
): Promise<CreateValidationObjectiveResult | null> {
  const opportunity = await db.opportunity.findFirst({ where: { id: input.opportunityId, userId: input.userId } });
  if (!opportunity) return null;

  const title = input.title?.trim() || `Validate: ${opportunity.title}`;
  const objective = await createObjective({
    userId: input.userId,
    title,
    description: input.description ?? opportunity.description ?? undefined,
  });

  await db.objective.update({ where: { id: objective.id }, data: { sourceOpportunityId: opportunity.id } });

  const advancingStatuses = new Set(["IDEA", "DISCOVERED", "RESEARCHING", "EVALUATING", "WATCHLIST", "APPROVED"]);
  const updatedOpportunity = advancingStatuses.has(opportunity.status)
    ? await updateOpportunity(input.userId, opportunity.id, { status: "PLANNING" })
    : toOpportunityDTO(opportunity);

  await recordEvent({
    userId: input.userId,
    type: "opportunity.objective_created",
    subjectType: "Opportunity",
    subjectId: opportunity.id,
    payload: { objectiveId: objective.id, title },
  });

  const reloadedObjective = await db.objective.findUniqueOrThrow({ where: { id: objective.id } });
  return { objective: toObjectiveDTO(reloadedObjective), opportunity: updatedOpportunity! };
}
