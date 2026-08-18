import { describe, it, expect, beforeAll } from "vitest";
import {
  createEconomicAsset,
  listEconomicAssets,
  getEconomicAsset,
  updateEconomicAsset,
  deleteEconomicAsset,
  addEconomicRevenue,
  addEconomicExpense,
  getEconomicOverview,
} from "@/lib/economic/service";
import { createObjective, createOpportunity } from "@/lib/objectives/service";
import { createTestUser } from "./helpers";

describe("economic command: assets and ledger", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates an asset with a real default status and no fabricated data", async () => {
    const asset = await createEconomicAsset({ userId, name: "Test Micro-SaaS", category: "MICRO_SAAS" });
    expect(asset.status).toBe("IDEA");
    expect(asset.opportunityId).toBeNull();
  });

  it("links an asset to a real opportunity when provided", async () => {
    const objective = await createObjective({ userId, title: "Grow income" });
    const opportunity = await createOpportunity({ userId, objectiveId: objective.id, title: "Sell a plugin" });
    if (!opportunity) throw new Error("expected opportunity to be created");
    const asset = await createEconomicAsset({
      userId,
      name: "Plugin Store",
      category: "DIGITAL_PRODUCT",
      opportunityId: opportunity.id,
    });
    expect(asset.opportunityId).toBe(opportunity.id);
  });

  it("getEconomicAsset returns real, summed totals — zero when nothing is logged", async () => {
    const asset = await createEconomicAsset({ userId, name: "Empty Asset", category: "WEBSITE" });
    const detail = await getEconomicAsset(userId, asset.id);
    expect(detail?.totals).toEqual({ totalRevenueUsd: 0, totalExpenseUsd: 0, profitUsd: 0 });
    expect(detail?.revenues).toHaveLength(0);
    expect(detail?.expenses).toHaveLength(0);
  });

  it("addEconomicRevenue and addEconomicExpense update the real totals correctly", async () => {
    const asset = await createEconomicAsset({ userId, name: "Ledger Asset", category: "CONTENT_ASSET" });
    await addEconomicRevenue(userId, asset.id, { amountUsd: 500, source: "Ad revenue", occurredAt: new Date() });
    await addEconomicRevenue(userId, asset.id, { amountUsd: 250, source: "Sponsorship", occurredAt: new Date() });
    await addEconomicExpense(userId, asset.id, { amountUsd: 100, category: "Hosting", occurredAt: new Date() });

    const detail = await getEconomicAsset(userId, asset.id);
    expect(detail?.totals.totalRevenueUsd).toBe(750);
    expect(detail?.totals.totalExpenseUsd).toBe(100);
    expect(detail?.totals.profitUsd).toBe(650);
    expect(detail?.revenues).toHaveLength(2);
    expect(detail?.expenses).toHaveLength(1);
  });

  it("addEconomicRevenue/Expense return null for an asset owned by someone else", async () => {
    const otherUser = await createTestUser();
    const asset = await createEconomicAsset({ userId, name: "Owned Asset", category: "OTHER" });
    const result = await addEconomicRevenue(otherUser.id, asset.id, { amountUsd: 10, occurredAt: new Date() });
    expect(result).toBeNull();
  });

  it("updateEconomicAsset patches fields and deleteEconomicAsset removes the row", async () => {
    const asset = await createEconomicAsset({ userId, name: "To Update", category: "OTHER", status: "IDEA" });
    const updated = await updateEconomicAsset(userId, asset.id, { status: "LAUNCHED" });
    expect(updated?.status).toBe("LAUNCHED");

    const deleted = await deleteEconomicAsset(userId, asset.id);
    expect(deleted).toBe(true);
    expect(await getEconomicAsset(userId, asset.id)).toBeNull();
  });

  it("getEconomicOverview sums real revenue/expense across every asset for the user, never a fabricated figure", async () => {
    const user = await createTestUser();
    const a = await createEconomicAsset({ userId: user.id, name: "Overview A", category: "WEBSITE", status: "OPERATING" });
    const b = await createEconomicAsset({ userId: user.id, name: "Overview B", category: "OTHER", status: "IDEA" });
    await addEconomicRevenue(user.id, a.id, { amountUsd: 1000, occurredAt: new Date() });
    await addEconomicExpense(user.id, b.id, { amountUsd: 200, occurredAt: new Date() });

    const overview = await getEconomicOverview(user.id);
    expect(overview.assetCount).toBe(2);
    expect(overview.operatingCount).toBe(1);
    expect(overview.totalRevenueUsd).toBe(1000);
    expect(overview.totalExpenseUsd).toBe(200);
    expect(overview.profitUsd).toBe(800);
  });

  it("listEconomicAssets only returns the requesting user's own assets", async () => {
    const user = await createTestUser();
    await createEconomicAsset({ userId: user.id, name: "Mine", category: "OTHER" });
    const otherUser = await createTestUser();
    await createEconomicAsset({ userId: otherUser.id, name: "Not mine", category: "OTHER" });

    const assets = await listEconomicAssets(user.id);
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("Mine");
  });
});
