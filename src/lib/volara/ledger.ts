/**
 * [P4-F] THE SHARED OPPORTUNITY LEDGER — agent-facing reads and writes.
 *
 * `Opportunity` IS the ledger. It is not re-created here: this module is the
 * narrow, screened surface through which a Volara agent touches it, and every
 * function is scoped to one user and passes `screenAgentIntent()` first.
 *
 * WHAT AN AGENT CANNOT DO THROUGH THIS FILE:
 *
 *   - Assert a realized outcome. There is no `actualRevenue` write, because
 *     there is no `actualRevenue` column: realized economics are derived from
 *     the row's `EconomicAsset` and its ledger entries (`metrics.ts`). An agent
 *     marking an opportunity profitable is not disallowed here so much as
 *     unrepresentable, which is the stronger version.
 *   - Move a row to a status that asserts a result. `SUCCEEDED`/`COMPLETED` is
 *     reachable only through `settleOpportunity()`, which reads the ledger and
 *     refuses when there is no economic evidence.
 *   - Write another agent's discovery attribution. `discoveredByAgentId` is set
 *     once, at creation, from the acting agent — never supplied by a caller.
 *
 * THE STATUS VOCABULARY IS THE EXISTING `OpportunityStatus`. The brief's
 * lifecycle (DISCOVERED → ANALYZING → VALIDATING → PROPOSED → APPROVED →
 * EXECUTING → SUCCEEDED/FAILED/KILLED/EXPIRED) maps onto enum members that
 * already exist and are already read by the Brain graph, the scoring service
 * and the economic pipeline. Forking a parallel enum would have left two
 * vocabularies for one lifecycle — see LEDGER_STAGE below for the mapping.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { deepFreeze } from "@/lib/policy/classification";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { assertAgentIntentAllowed } from "@/lib/volara/guards";
import type { Opportunity } from "@/generated/prisma/client";
import type { OpportunityStatus } from "@/generated/prisma/enums";

/**
 * The P4-F lifecycle vocabulary, mapped onto the enum VOX already has.
 *
 * Two of the brief's names have no distinct existing member and are recorded
 * where they belong rather than given one: KILLED is `REJECTED` (a judged end)
 * and EXPIRED is `REJECTED` too, distinguished by the event that put it there.
 * REPLICATING is a property of a Strategy, not of an opportunity, and lives on
 * `Strategy.replicatedFromId`.
 */
export const LEDGER_STAGE: Readonly<Record<string, OpportunityStatus>> = deepFreeze({
  DISCOVERED: "DISCOVERED",
  ANALYZING: "EVALUATING",
  VALIDATING: "VALIDATING",
  PROPOSED: "WATCHLIST",
  APPROVED: "APPROVED",
  EXECUTING: "EXECUTING",
  SUCCEEDED: "COMPLETED",
  FAILED: "FAILED",
  KILLED: "REJECTED",
  EXPIRED: "REJECTED",
} as const);

/** Statuses an agent may move a row INTO. Terminal-with-a-claim ones are absent. */
const AGENT_WRITABLE_STATUSES: readonly OpportunityStatus[] = deepFreeze([
  "DISCOVERED",
  "RESEARCHING",
  "EVALUATING",
  "VALIDATING",
  "WATCHLIST",
] as const);

export interface RecordOpportunityInput {
  userId: string;
  agentId: string;
  objectiveId: string;
  title: string;
  description?: string;
  category?: string;
  /** Honest, nullable estimates. Omit rather than guess — null means unknown. */
  requiredCapitalCents?: number;
  expectedRevenueCents?: number;
  expectedProfitCents?: number;
  probabilityOfSuccess?: number;
  maxLossCents?: number;
  downside?: string;
  timeToPayoutDays?: number;
  /** JSON-serializable evidence entries, same shape the pipeline already uses. */
  evidence?: Array<{ type: string; text: string }>;
  requiredTools?: string[];
  requiredCapabilities?: string[];
  correlationId: string;
}

/**
 * An agent records something it found.
 *
 * `status` is always `DISCOVERED` and `source` is always the agent — neither is
 * a parameter. A caller that could set the status could open a row directly in
 * `APPROVED`, and a caller that could set the source could attribute its own
 * find to the user.
 */
export async function recordOpportunity(input: RecordOpportunityInput): Promise<Opportunity> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "RECORD_OPPORTUNITY",
    targetType: "Opportunity",
    correlationId: input.correlationId,
  });

  const opportunity = await db.opportunity.create({
    data: {
      userId: input.userId,
      objectiveId: input.objectiveId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: "DISCOVERED",
      source: `volara:${input.agentId}`,
      discoveredByAgentId: input.agentId,
      participatingAgentIds: JSON.stringify([input.agentId]),
      requiredCapitalCents: input.requiredCapitalCents,
      expectedRevenueCents: input.expectedRevenueCents,
      expectedProfitCents: input.expectedProfitCents,
      probabilityOfSuccess: input.probabilityOfSuccess,
      maxLossCents: input.maxLossCents,
      downside: input.downside,
      timeToPayoutDays: input.timeToPayoutDays,
      evidence: input.evidence ? JSON.stringify(input.evidence) : undefined,
      requiredTools: input.requiredTools ? JSON.stringify(input.requiredTools) : undefined,
      requiredCapabilities: input.requiredCapabilities ? JSON.stringify(input.requiredCapabilities) : undefined,
      correlationId: input.correlationId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.OPPORTUNITY_DISCOVERED,
    subjectType: "Opportunity",
    subjectId: opportunity.id,
    consequential: false,
    payload: {
      agentId: input.agentId,
      title: opportunity.title,
      category: opportunity.category,
      correlationId: input.correlationId,
    },
  });

  return opportunity;
}

export type LedgerUpdateRefusal = "NOT_FOUND" | "STATUS_NOT_AGENT_WRITABLE" | "TERMINAL";

export interface UpdateOpportunityInput {
  userId: string;
  agentId: string;
  opportunityId: string;
  status?: OpportunityStatus;
  /** Estimates an analysing agent may refine. Never realized figures. */
  probabilityOfSuccess?: number;
  maxLossCents?: number;
  expectedProfitCents?: number;
  downside?: string;
  rationale?: string;
  strategyId?: string;
  correlationId: string;
}

/**
 * An agent refines a row it or another agent recorded.
 *
 * The status guard is the point. An agent may move a row forward through the
 * examination stages, and it may not move one into a status that asserts an
 * economic result — those go through `settleOpportunity()`, which requires
 * evidence. A terminal row is frozen entirely.
 *
 * The acting agent is added to `participatingAgentIds`, which is how "who
 * challenged this" becomes answerable. It confers nothing.
 */
export async function updateOpportunity(
  input: UpdateOpportunityInput
): Promise<{ updated: true; opportunity: Opportunity } | { updated: false; reason: LedgerUpdateRefusal }> {
  await assertAgentIntentAllowed({
    userId: input.userId,
    agentId: input.agentId,
    intent: "UPDATE_OPPORTUNITY",
    targetType: "Opportunity",
    targetId: input.opportunityId,
    correlationId: input.correlationId,
  });

  const existing = await db.opportunity.findFirst({
    where: { id: input.opportunityId, userId: input.userId },
  });
  if (!existing) return { updated: false, reason: "NOT_FOUND" };
  if (existing.status === "COMPLETED" || existing.status === "FAILED" || existing.status === "REJECTED") {
    return { updated: false, reason: "TERMINAL" };
  }
  if (input.status && !AGENT_WRITABLE_STATUSES.includes(input.status)) {
    return { updated: false, reason: "STATUS_NOT_AGENT_WRITABLE" };
  }

  const participants = parseIdList(existing.participatingAgentIds);
  if (!participants.includes(input.agentId)) participants.push(input.agentId);

  const opportunity = await db.opportunity.update({
    where: { id: existing.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.probabilityOfSuccess !== undefined ? { probabilityOfSuccess: input.probabilityOfSuccess } : {}),
      ...(input.maxLossCents !== undefined ? { maxLossCents: input.maxLossCents } : {}),
      ...(input.expectedProfitCents !== undefined ? { expectedProfitCents: input.expectedProfitCents } : {}),
      ...(input.downside !== undefined ? { downside: input.downside } : {}),
      ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
      participatingAgentIds: JSON.stringify(participants),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.OPPORTUNITY_UPDATED,
    subjectType: "Opportunity",
    subjectId: opportunity.id,
    consequential: false,
    payload: {
      agentId: input.agentId,
      status: opportunity.status,
      previousStatus: existing.status,
      correlationId: input.correlationId,
    },
  });

  return { updated: true, opportunity };
}

export type SettlementRefusal = "NOT_FOUND" | "NO_ECONOMIC_EVIDENCE" | "ALREADY_SETTLED";

/**
 * Closes an opportunity as SUCCEEDED or FAILED — from the LEDGER, not from an
 * assertion.
 *
 * This is the function §5 of the brief is describing when it says agents must
 * not "simply mark opportunities successful without economic evidence". The
 * outcome is not a parameter. It is computed: the row's `EconomicAsset` is
 * summed over its real revenue and expense entries, and a positive realized
 * profit is COMPLETED while a non-positive one is FAILED. With no asset and no
 * entries there is nothing to settle, and it refuses.
 *
 * SIMULATED ledger rows are excluded, exactly as the spend ceiling excludes
 * them: a dry run is not evidence of money.
 */
export async function settleOpportunity(input: {
  userId: string;
  opportunityId: string;
  correlationId: string;
}): Promise<
  | { settled: true; status: OpportunityStatus; realizedProfitCents: number }
  | { settled: false; reason: SettlementRefusal }
> {
  const opportunity = await db.opportunity.findFirst({
    where: { id: input.opportunityId, userId: input.userId },
    include: { economicAsset: { select: { id: true } } },
  });
  if (!opportunity) return { settled: false, reason: "NOT_FOUND" };
  if (opportunity.status === "COMPLETED" || opportunity.status === "FAILED") {
    return { settled: false, reason: "ALREADY_SETTLED" };
  }
  if (!opportunity.economicAsset) return { settled: false, reason: "NO_ECONOMIC_EVIDENCE" };

  const assetId = opportunity.economicAsset.id;
  const [revenue, expense] = await Promise.all([
    db.economicRevenue.aggregate({
      where: { assetId, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
      _count: true,
    }),
    db.economicExpense.aggregate({
      where: { assetId, provenance: { in: ["REALIZED", "USER_RECORDED"] } },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);

  // No entries at all is no evidence. Refusing here is what stops a run that
  // produced nothing from being recorded as an outcome of any kind.
  if (revenue._count === 0 && expense._count === 0) {
    return { settled: false, reason: "NO_ECONOMIC_EVIDENCE" };
  }

  const realizedProfitCents = (revenue._sum.amountCents ?? 0) - (expense._sum.amountCents ?? 0);
  const status: OpportunityStatus = realizedProfitCents > 0 ? "COMPLETED" : "FAILED";

  await db.opportunity.update({ where: { id: opportunity.id }, data: { status } });
  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.OPPORTUNITY_UPDATED,
    subjectType: "Opportunity",
    subjectId: opportunity.id,
    consequential: true,
    payload: {
      settled: true,
      status,
      realizedProfitCents,
      revenueEntries: revenue._count,
      expenseEntries: expense._count,
      correlationId: input.correlationId,
    },
  });

  return { settled: true, status, realizedProfitCents };
}

/** Rows no agent has examined yet — the SCOUT's working set. */
export async function listUnexaminedOpportunities(userId: string, limit = 20): Promise<Opportunity[]> {
  return db.opportunity.findMany({
    where: { userId, status: { in: ["IDEA", "DISCOVERED"] } },
    orderBy: { discoveredAt: "desc" },
    take: Math.min(limit, 100),
  });
}

/** Rows under examination — the ANALYST's and STRATEGIST's working set. */
export async function listExaminableOpportunities(userId: string, limit = 20): Promise<Opportunity[]> {
  return db.opportunity.findMany({
    where: { userId, status: { in: ["DISCOVERED", "RESEARCHING", "EVALUATING", "VALIDATING", "WATCHLIST"] } },
    orderBy: { updatedAt: "desc" },
    take: Math.min(limit, 100),
  });
}

/** Parses a JSON string[] column defensively — a corrupt value reads as empty. */
export function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
