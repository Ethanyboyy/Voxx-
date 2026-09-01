// Economic Command service layer — real assets, real revenue/expense rows,
// nothing computed or fabricated. See prisma/schema.prisma's Economic
// Command section for why this has no capability-gating: it's direct user
// CRUD on their own data, same posture as Objectives/Opportunities/Tasks.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { assertNotHalted } from "@/lib/economic/halt";
import { normalizeAmount, sumCents, fromCents } from "@/lib/economic/money";
import { getPolicySpendPosition } from "@/lib/economic/accounting";
import { recordPolicySpend } from "@/lib/economic/spend";
import type { EconomicAssetCategory, EconomicAssetStatus, LedgerProvenance } from "@/generated/prisma/enums";
import type { EconomicAsset, EconomicExpense, EconomicRevenue } from "@/generated/prisma/client";

export interface EconomicAssetDTO {
  id: string;
  userId: string;
  opportunityId: string | null;
  name: string;
  category: EconomicAssetCategory;
  status: EconomicAssetStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAssetDTO(row: EconomicAsset): EconomicAssetDTO {
  return {
    id: row.id,
    userId: row.userId,
    opportunityId: row.opportunityId,
    name: row.name,
    category: row.category,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateEconomicAssetInput {
  userId: string;
  opportunityId?: string;
  name: string;
  category: EconomicAssetCategory;
  status?: EconomicAssetStatus;
  description?: string;
}

export async function createEconomicAsset(input: CreateEconomicAssetInput): Promise<EconomicAssetDTO> {
  const row = await db.economicAsset.create({
    data: {
      userId: input.userId,
      opportunityId: input.opportunityId,
      name: input.name,
      category: input.category,
      status: input.status ?? "IDEA",
      description: input.description,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "economic_asset.created",
    subjectType: "EconomicAsset",
    subjectId: row.id,
    payload: { name: row.name, category: row.category },
  });

  return toAssetDTO(row);
}

export async function listEconomicAssets(userId: string): Promise<EconomicAssetDTO[]> {
  const rows = await db.economicAsset.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toAssetDTO);
}

export interface EconomicAssetTotals {
  totalRevenueUsd: number;
  totalExpenseUsd: number;
  profitUsd: number;
}

export interface EconomicAssetWithLedgerDTO extends EconomicAssetDTO {
  revenues: EconomicRevenue[];
  expenses: EconomicExpense[];
  totals: EconomicAssetTotals;
}

/**
 * Sums a ledger in integer cents and returns USD.
 *
 * Reads `amountCents`, never `amountUsd`: summing the Float column reintroduces
 * exactly the drift the cents migration removed, and this total feeds the
 * asset-level profit figure a person reads.
 */
function sumAmount(rows: { amountCents: number }[]): number {
  return fromCents(sumCents(rows.map((r) => r.amountCents)));
}

export async function getEconomicAsset(userId: string, id: string): Promise<EconomicAssetWithLedgerDTO | null> {
  const row = await db.economicAsset.findFirst({
    where: { id, userId },
    include: {
      revenues: { orderBy: { occurredAt: "desc" } },
      expenses: { orderBy: { occurredAt: "desc" } },
    },
  });
  if (!row) return null;

  const totalRevenueUsd = sumAmount(row.revenues);
  const totalExpenseUsd = sumAmount(row.expenses);

  return {
    ...toAssetDTO(row),
    revenues: row.revenues,
    expenses: row.expenses,
    totals: { totalRevenueUsd, totalExpenseUsd, profitUsd: totalRevenueUsd - totalExpenseUsd },
  };
}

export interface UpdateEconomicAssetInput {
  name?: string;
  category?: EconomicAssetCategory;
  status?: EconomicAssetStatus;
  description?: string;
}

export async function updateEconomicAsset(
  userId: string,
  id: string,
  updates: UpdateEconomicAssetInput
): Promise<EconomicAssetDTO | null> {
  const existing = await db.economicAsset.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const row = await db.economicAsset.update({ where: { id }, data: updates });

  if (updates.status && updates.status !== existing.status) {
    await recordEvent({
      userId,
      type: "economic_asset.status_changed",
      subjectType: "EconomicAsset",
      subjectId: id,
      payload: { from: existing.status, to: updates.status },
    });
  }

  return toAssetDTO(row);
}

export async function deleteEconomicAsset(userId: string, id: string): Promise<boolean> {
  const existing = await db.economicAsset.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.economicAsset.delete({ where: { id } });
  return true;
}

export interface AddEconomicLedgerEntryInput {
  amountUsd: number;
  source?: string;
  category?: string;
  occurredAt: Date;
  notes?: string;
  /**
   * How much this row can be trusted as money. Defaults to USER_RECORDED —
   * the honest description of a number a human typed in.
   *
   * REALIZED is deliberately unreachable from here: it means "confirmed
   * against an external system of record", and VOX has no payment or banking
   * integration to confirm anything against. Accepting it from a caller would
   * let an agent (or a form post) label unverified data as verified, which is
   * precisely the distinction the enum exists to protect. When a real
   * integration lands, it writes REALIZED from inside its own provider module.
   */
  provenance?: Exclude<LedgerProvenance, "REALIZED">;
}

/**
 * Refuses a REALIZED provenance at runtime (invariant I1).
 *
 * The `Exclude<LedgerProvenance, "REALIZED">` on the input type stops honest
 * TypeScript callers, and nothing else. A cast, a JSON payload widened through
 * `as never`, or a future JS caller all walk straight past it — and REALIZED is
 * the one label that asserts an external system confirmed the money. Nothing in
 * VOX can confirm anything, so nothing in VOX may claim it. When a real payment
 * integration lands it will write REALIZED from inside its own provider module,
 * which is a different, reviewable code path.
 */
function assertNotRealized(provenance: LedgerProvenance | undefined): void {
  if (provenance === "REALIZED") {
    throw new Error(
      "REALIZED provenance cannot be written through an ordinary ledger API: it means confirmed against an external system of record, and no payment or banking integration is configured."
    );
  }
}

export async function addEconomicRevenue(
  userId: string,
  assetId: string,
  input: AddEconomicLedgerEntryInput
): Promise<EconomicRevenue | null> {
  const asset = await db.economicAsset.findFirst({ where: { id: assetId, userId } });
  if (!asset) return null;

  assertNotRealized(input.provenance);
  // The service boundary validates, not just the API schema. This function is
  // reachable from route handlers, from tools, and from other service code, and
  // only one of those three has a zod schema in front of it. NaN, Infinity,
  // zero, negative and absurd amounts are rejected here (see money.ts), so the
  // ledger cannot hold a value that breaks every sum computed from it.
  const amount = normalizeAmount(input.amountUsd, "amountUsd");

  const row = await db.economicRevenue.create({
    data: {
      assetId,
      amountUsd: amount.usd,
      amountCents: amount.cents,
      source: input.source,
      provenance: input.provenance ?? "USER_RECORDED",
      occurredAt: input.occurredAt,
      notes: input.notes,
    },
  });

  await recordEvent({
    userId,
    type: "economic_asset.revenue_logged",
    subjectType: "EconomicAsset",
    subjectId: assetId,
    payload: { amountUsd: row.amountUsd },
  });

  return row;
}

export async function addEconomicExpense(
  userId: string,
  assetId: string,
  input: AddEconomicLedgerEntryInput
): Promise<EconomicExpense | null> {
  const asset = await db.economicAsset.findFirst({ where: { id: assetId, userId } });
  if (!asset) return null;

  assertNotRealized(input.provenance);
  // Validated here for the same reason as revenue above — see money.ts.
  const amount = normalizeAmount(input.amountUsd, "amountUsd");

  const row = await db.economicExpense.create({
    data: {
      assetId,
      amountUsd: amount.usd,
      amountCents: amount.cents,
      category: input.category,
      provenance: input.provenance ?? "USER_RECORDED",
      occurredAt: input.occurredAt,
      notes: input.notes,
    },
  });

  await recordEvent({
    userId,
    type: "economic_asset.expense_logged",
    subjectType: "EconomicAsset",
    subjectId: assetId,
    payload: { amountUsd: row.amountUsd },
  });

  return row;
}

/** Real totals across every asset — never a projection, never a forecast,
 * only the sum of what's actually been logged. Used by the Finance page
 * overview and (via the Orchestrator) anywhere VOX needs an honest
 * economic snapshot. */
export async function getEconomicOverview(userId: string) {
  const assets = await db.economicAsset.findMany({
    where: { userId },
    include: { revenues: true, expenses: true },
  });

  const totalRevenueUsd = sumAmount(assets.flatMap((a) => a.revenues));
  const totalExpenseUsd = sumAmount(assets.flatMap((a) => a.expenses));

  return {
    assetCount: assets.length,
    operatingCount: assets.filter((a) => a.status === "OPERATING" || a.status === "LAUNCHED").length,
    totalRevenueUsd,
    totalExpenseUsd,
    profitUsd: totalRevenueUsd - totalExpenseUsd,
  };
}

// ---------------------------------------------------------------------------
// Economic Engine: capability-gated agent spend. Unlike the rest of this
// file (direct, ungated user CRUD — see the header comment), this path is
// reached only through the economic.record_expense Tool Registry entry,
// which requires the "economic.spend" capability at ACT level AND passes
// evaluateSpendPolicy()'s budget-ceiling check — two independent gates, so
// a granted capability alone is never sufficient for an agent to spend.
// ---------------------------------------------------------------------------

/** Finds the opportunity's promoted EconomicAsset, or creates a minimal one
 * — same "promoted, not just labeled" posture as promoteOpportunityToProject.
 * Never silently reuses a DIFFERENT opportunity's asset (opportunityId is
 * @unique on EconomicAsset). */
async function findOrCreateAssetForOpportunity(userId: string, opportunityId: string): Promise<EconomicAsset> {
  const existing = await db.economicAsset.findUnique({ where: { opportunityId } });
  if (existing) return existing;

  const opportunity = await db.opportunity.findFirstOrThrow({ where: { id: opportunityId, userId } });
  const created = await db.economicAsset.create({
    data: { userId, opportunityId, name: opportunity.title, category: "OTHER", status: "IDEA" },
  });
  await recordEvent({
    userId,
    type: "economic_asset.created",
    subjectType: "EconomicAsset",
    subjectId: created.id,
    payload: { name: created.name, category: created.category, autoCreatedForOpportunity: opportunityId },
  });
  return created;
}

export interface RecordOpportunitySpendInput {
  opportunityId: string;
  amountUsd: number;
  category?: string;
  notes?: string;
}

export async function recordOpportunitySpend(userId: string, input: RecordOpportunitySpendInput): Promise<EconomicExpense> {
  // Fail fast on an obviously halted engine so no asset is auto-created for a
  // spend that cannot happen. This is a courtesy check, NOT the enforcement:
  // the authoritative halt and ceiling checks both live inside the single
  // atomic statement in recordPolicySpend(), where nothing can slip between
  // the check and the write.
  await assertNotHalted(userId);

  const asset = await findOrCreateAssetForOpportunity(userId, input.opportunityId);

  // The one autonomous spend boundary. It enforces the remaining ceiling
  // itself — see src/lib/economic/spend.ts for why the check and the insert
  // have to be the same statement.
  return recordPolicySpend(userId, {
    assetId: asset.id,
    amountUsd: input.amountUsd,
    category: input.category,
    notes: input.notes,
  });
}

export interface BudgetSummary {
  maxAutonomousSpendUsd: number;
  totalSpentUsd: number;
  /** Real sum of every EconomicExpense ever logged, autonomous or manual —
   * never a projection. `remainingAutonomousUsd` compares this against the
   * ceiling only as an at-a-glance signal; each individual spend action is
   * still evaluated independently against the ceiling, not against a
   * running "budget balance" that could drift or double-count. */
  remainingAutonomousUsd: number;
  /**
   * Simulated spend, reported beside the real figures and never inside them.
   * A dry run is visible as a dry run rather than silently eating the ceiling.
   */
  simulatedSpendUsd: number;
}

/**
 * The budget panel's numbers, from the ONE canonical definition.
 *
 * This used to sum every EconomicExpense row regardless of provenance, so a
 * SIMULATED dry run consumed the user's real ceiling — and disagreed with the
 * P&L capital posture, which filtered provenance, on the same screen. Both now
 * read getPolicySpendPosition(); there is no second definition left to drift.
 */
export async function getBudgetSummary(userId: string): Promise<BudgetSummary> {
  const position = await getPolicySpendPosition(userId);
  return {
    maxAutonomousSpendUsd: position.ceilingUsd,
    totalSpentUsd: position.spentUsd,
    remainingAutonomousUsd: position.remainingUsd,
    simulatedSpendUsd: position.simulatedUsd,
  };
}
