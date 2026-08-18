import { describe, it, expect, beforeAll } from "vitest";
import { createSuit } from "@/lib/lab/suits";
import {
  createComponent,
  getComponentTree,
  deleteComponent,
  updateComponent,
  addComponentDependency,
  removeComponentDependency,
} from "@/lib/lab/components";
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

describe("suit digital twin: subsystem/power/cost/risk/reality + dependencies", () => {
  let suitId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId: user.id, codename: "Digital Twin Test Suit", archetype: "Tactical", stats: SAMPLE_STATS });
    suitId = suit.id;
  });

  it("creates a component with subsystem/power/cost/risk/realityStatus, defaulting sensibly", async () => {
    const noDefaults = await createComponent({ suitId, name: "Unclassified Part" });
    expect(noDefaults.subsystem).toBeNull();
    expect(noDefaults.riskLevel).toBe("UNKNOWN");
    expect(noDefaults.realityStatus).toBe("CONCEPT");

    const hud = await createComponent({
      suitId,
      name: "HUD Projector",
      subsystem: "HEAD",
      powerDrawW: 4.5,
      costUsd: 220,
      riskLevel: "MODERATE",
      realityStatus: "PROTOTYPE",
    });
    expect(hud.subsystem).toBe("HEAD");
    expect(hud.powerDrawW).toBe(4.5);
    expect(hud.costUsd).toBe(220);
    expect(hud.riskLevel).toBe("MODERATE");
    expect(hud.realityStatus).toBe("PROTOTYPE");
  });

  it("updateComponent patches fields, including clearing a nullable one", async () => {
    const c = await createComponent({ suitId, name: "Power Core", subsystem: "CORE", powerDrawW: 40 });
    const updated = await updateComponent(c.id, { powerDrawW: 55, riskLevel: "HIGH" });
    expect(updated.powerDrawW).toBe(55);
    expect(updated.riskLevel).toBe("HIGH");

    const cleared = await updateComponent(c.id, { subsystem: null });
    expect(cleared.subsystem).toBeNull();
  });

  it("tracks directed dependencies between components and surfaces them in the tree", async () => {
    const power = await createComponent({ suitId, name: "Power Core II", subsystem: "CORE" });
    const hud = await createComponent({ suitId, name: "HUD Projector II", subsystem: "HEAD" });

    await addComponentDependency(userId, hud.id, power.id, "Draws from the core power bus");

    const tree = await getComponentTree({ suitId });
    const hudNode = tree.find((c) => c.id === hud.id)!;
    expect(hudNode.dependsOn).toHaveLength(1);
    expect(hudNode.dependsOn[0].dependsOnName).toBe("Power Core II");
    expect(hudNode.dependsOn[0].note).toBe("Draws from the core power bus");
  });

  it("rejects a component depending on itself", async () => {
    const c = await createComponent({ suitId, name: "Self Dependent" });
    await expect(addComponentDependency(userId, c.id, c.id)).rejects.toThrow();
  });

  it("removeComponentDependency deletes the edge without touching either component", async () => {
    const a = await createComponent({ suitId, name: "Dep A" });
    const b = await createComponent({ suitId, name: "Dep B" });
    const dep = await addComponentDependency(userId, a.id, b.id);

    await removeComponentDependency(dep.id);

    const tree = await getComponentTree({ suitId });
    const aNode = tree.find((c) => c.id === a.id)!;
    expect(aNode.dependsOn).toHaveLength(0);
    expect(tree.find((c) => c.id === b.id)).toBeDefined();
  });
});
