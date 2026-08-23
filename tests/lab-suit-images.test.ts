import { describe, it, expect, beforeAll } from "vitest";
import { createSuit } from "@/lib/lab/suits";
import { listSuitImages, addSuitImage, deleteSuitImage } from "@/lib/lab/suitImages";
import { subscribeToEvents, type LiveEvent } from "@/lib/events/bus";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 80, durability: 50, mobility: 65, stretchiness: 60, weightKg: 4.2, thermalLoadC: 32,
  protection: 45, environmentalResistance: 55, manufacturingComplexity: 60, estimatedBuildHours: 140,
  estimatedCostUsd: 32000, flexibility: 60, impactResistance: 45, visibility: 20, noiseProfile: 15,
  sensorCapacity: 55, energyRequirementW: 18, maintenanceComplexity: 45, confidence: "ESTIMATED",
};

describe("lab suit concept images", () => {
  let userId: string;
  let suitId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId, codename: "Imaged Suit", archetype: "Stealth", stats: SAMPLE_STATS });
    suitId = suit.id;
  });

  it("returns an empty list for a suit with no attached art", async () => {
    const images = await listSuitImages(userId, suitId);
    expect(images).toEqual([]);
  });

  it("returns null for a suit the user does not own", async () => {
    const other = await createTestUser();
    expect(await listSuitImages(other.id, suitId)).toBeNull();
    expect(await addSuitImage({ userId: other.id, suitId, kind: "CONCEPT", url: "https://example.com/a.png" })).toBeNull();
    expect(await deleteSuitImage(other.id, suitId, "nonexistent")).toBe(false);
  });

  it("attaches, lists in creation order, and removes real image references", async () => {
    const received: LiveEvent[] = [];
    const unsubscribe = subscribeToEvents(userId, (event) => received.push(event));

    try {
      const concept = await addSuitImage({ userId, suitId, kind: "CONCEPT", url: "https://example.com/concept.png", label: "Hero shot" });
      expect(concept).not.toBeNull();
      expect(concept!.kind).toBe("CONCEPT");
      expect(concept!.url).toBe("https://example.com/concept.png");
      expect(concept!.label).toBe("Hero shot");

      const front = await addSuitImage({ userId, suitId, kind: "FRONT", url: "https://example.com/front.png" });
      expect(front!.label).toBeNull();

      const images = await listSuitImages(userId, suitId);
      expect(images).not.toBeNull();
      expect(images!.map((i) => i.id)).toEqual([concept!.id, front!.id]);

      expect(received.some((e) => e.type === "lab.suit.image_added" && e.subjectId === suitId)).toBe(true);

      const deleted = await deleteSuitImage(userId, suitId, concept!.id);
      expect(deleted).toBe(true);

      const afterDelete = await listSuitImages(userId, suitId);
      expect(afterDelete!.map((i) => i.id)).toEqual([front!.id]);

      expect(received.some((e) => e.type === "lab.suit.image_removed" && e.subjectId === suitId)).toBe(true);

      expect(await deleteSuitImage(userId, suitId, concept!.id)).toBe(false);
    } finally {
      unsubscribe();
    }
  });
});
