import { describe, it, expect, beforeAll } from "vitest";
import { createSuit } from "@/lib/lab/suits";
import { createComponent, getComponentTree, deleteComponent } from "@/lib/lab/components";
import { createMaterial } from "@/lib/lab/materials";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 70, durability: 50, mobility: 60, stretchiness: 55, weightKg: 4, thermalLoadC: 30,
  protection: 45, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 28000, flexibility: 55, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40,
};

describe("lab component hierarchy (Fallout-style inspection)", () => {
  let suitId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    const suit = await createSuit({ userId: user.id, codename: "Tree Test Suit", archetype: "Recon", stats: SAMPLE_STATS });
    suitId = suit.id;
    const material = await createMaterial({ name: "Test Weave", category: "Textile", densityGCm3: 1, tensileStrengthMpa: 100, elasticityPercent: 50, abrasionResistance: 50, temperatureResistanceC: 100, moistureResistance: 50, costPerKgUsd: 20 });

    const mask = await createComponent({ suitId, name: "Mask", order: 0 });
    const lens = await createComponent({ suitId, parentId: mask.id, name: "Lens System", materialId: material.id, order: 0 });
    await createComponent({ suitId, parentId: lens.id, name: "Optical Module", order: 0 });
    await createComponent({ suitId, parentId: lens.id, name: "Sensor Component", order: 1 });
    await createComponent({ suitId, name: "Structural Layer", order: 1 });
  });

  it("assembles a nested tree from flat component rows, in order", async () => {
    const tree = await getComponentTree({ suitId });
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("Mask");
    expect(tree[1].name).toBe("Structural Layer");

    const lens = tree[0].children[0];
    expect(lens.name).toBe("Lens System");
    expect(lens.materialName).toBe("Test Weave");
    expect(lens.children.map((c) => c.name)).toEqual(["Optical Module", "Sensor Component"]);
  });

  it("deleting a component removes it (and cascades to its children via the FK)", async () => {
    const before = await getComponentTree({ suitId });
    const mask = before.find((c) => c.name === "Mask")!;
    const lens = mask.children.find((c) => c.name === "Lens System")!;

    await deleteComponent(lens.id);

    const after = await getComponentTree({ suitId });
    const maskAfter = after.find((c) => c.name === "Mask")!;
    expect(maskAfter.children.find((c) => c.name === "Lens System")).toBeUndefined();
  });
});
