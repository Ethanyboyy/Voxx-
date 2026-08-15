import { describe, it, expect, beforeAll } from "vitest";
import { createSuit, createSuitVersion, duplicateSuit, getSuit, listSuits, compareSuits, updateSuit } from "@/lib/lab/suits";
import { createComponent } from "@/lib/lab/components";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 80, durability: 50, mobility: 65, stretchiness: 60, weightKg: 4.2, thermalLoadC: 32,
  protection: 45, environmentalResistance: 55, manufacturingComplexity: 60, estimatedBuildHours: 140,
  estimatedCostUsd: 32000, flexibility: 60, impactResistance: 45, visibility: 20, noiseProfile: 15,
  sensorCapacity: 55, energyRequirementW: 18, maintenanceComplexity: 45, confidence: "ESTIMATED",
};

describe("lab suits service", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates a suit with a current version and stats attached", async () => {
    const suit = await createSuit({ userId, codename: "Test Suit A", archetype: "Stealth", stats: SAMPLE_STATS });
    expect(suit.currentVersionId).toBeTruthy();

    const fetched = await getSuit(userId, suit.id);
    expect(fetched?.currentVersion?.label).toBe("v0.1");
    expect(fetched?.currentVersion?.stats?.stealth).toBe(80);
  });

  it("scopes listing to the owning user", async () => {
    const other = await createTestUser();
    await createSuit({ userId: other.id, codename: "Not mine", archetype: "Combat", stats: SAMPLE_STATS });
    const mine = await listSuits(userId);
    expect(mine.some((s) => s.codename === "Not mine")).toBe(false);
  });

  it("creates a new version and moves currentVersion forward", async () => {
    const suit = await createSuit({ userId, codename: "Versioned Suit", archetype: "Utility", stats: SAMPLE_STATS });
    const v2 = await createSuitVersion(userId, suit.id, {
      label: "v0.2",
      note: "Lighter build",
      stats: { ...SAMPLE_STATS, weightKg: 3.5 },
    });
    expect(v2?.stats?.weightKg).toBe(3.5);

    const refreshed = await getSuit(userId, suit.id);
    expect(refreshed?.currentVersion?.label).toBe("v0.2");
    expect(refreshed?.versions.length).toBe(2);
  });

  it("duplicates a suit including its component tree, under a new codename and HYPOTHETICAL confidence", async () => {
    const suit = await createSuit({ userId, codename: "Original Design", archetype: "Recon", stats: SAMPLE_STATS });
    const parent = await createComponent({ suitId: suit.id, name: "Mask", order: 0 });
    await createComponent({ suitId: suit.id, parentId: parent.id, name: "Lens System", order: 0 });

    const copy = await duplicateSuit(userId, suit.id, "Original Design II");
    expect(copy?.codename).toBe("Original Design II");
    expect(copy?.status).toBe("EXPERIMENTAL");

    const copyDetail = await getSuit(userId, copy!.id);
    expect(copyDetail?.currentVersion?.stats?.confidence).toBe("HYPOTHETICAL");
    expect(copyDetail?.components.some((c) => c.name === "Mask")).toBe(true);
  });

  it("compareSuits returns only suits the user owns", async () => {
    const a = await createSuit({ userId, codename: "Compare A", archetype: "Aerial", stats: SAMPLE_STATS });
    const b = await createSuit({ userId, codename: "Compare B", archetype: "Combat", stats: SAMPLE_STATS });
    const other = await createTestUser();
    const foreign = await createSuit({ userId: other.id, codename: "Compare Foreign", archetype: "Urban", stats: SAMPLE_STATS });

    const result = await compareSuits(userId, [a.id, b.id, foreign.id]);
    expect(result.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("archiving a suit is scoped to the owner and rejects a foreign id", async () => {
    const suit = await createSuit({ userId, codename: "Archive Me", archetype: "Tactical", stats: SAMPLE_STATS });
    const other = await createTestUser();
    const denied = await updateSuit(other.id, suit.id, { status: "ARCHIVED" });
    expect(denied).toBeNull();

    const allowed = await updateSuit(userId, suit.id, { status: "ARCHIVED" });
    expect(allowed?.status).toBe("ARCHIVED");
  });
});
