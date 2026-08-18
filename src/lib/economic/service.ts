// Economic Command service layer — real assets, real revenue/expense rows,
// nothing computed or fabricated. See prisma/schema.prisma's Economic
// Command section for why this has no capability-gating: it's direct user
// CRUD on their own data, same posture as Objectives/Opportunities/Tasks.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { EconomicAssetCategory, EconomicAssetStatus } from "@/generated/prisma/enums";
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

function sumAmount(rows: { amountUsd: number }[]): number {
  return rows.reduce((total, r) => total + r.amountUsd, 0);
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
}

export async function addEconomicRevenue(
  userId: string,
  assetId: string,
  input: AddEconomicLedgerEntryInput
): Promise<EconomicRevenue | null> {
  const asset = await db.economicAsset.findFirst({ where: { id: assetId, userId } });
  if (!asset) return null;

  const row = await db.economicRevenue.create({
    data: {
      assetId,
      amountUsd: input.amountUsd,
      source: input.source,
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

  const row = await db.economicExpense.create({
    data: {
      assetId,
      amountUsd: input.amountUsd,
      category: input.category,
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
