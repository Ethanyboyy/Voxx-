import { describe, expect, it } from "vitest";
import { costComponent, PROCESS_MULTIPLIER } from "@/lib/lab/cost";
import {
  ASSEMBLY_ORDER,
  SLOT_COMPONENTS,
  allSelectableIds,
  idsInAssembly,
  specFor,
} from "@/lib/lab/slotBridge";
import type { ArmorSlot } from "@/components/lab/three/suitConfig";

/**
 * The bridge and the costing model are the two things that turn the suit from
 * a picture into an inspectable engineering object, so both are pinned here
 * against the failure modes that would quietly break them.
 */

const SLOT_IDS: ArmorSlot[] = [
  "collar", "chest", "backpack", "shoulderL", "shoulderR", "forearmL", "forearmR",
  "belt", "thighL", "thighR", "shinL", "shinR", "kneeL", "kneeR",
  "gloveL", "gloveR", "bootL", "bootR",
];

describe("ArmorSlot ↔ LabComponent bridge", () => {
  it("maps every renderable armour slot, with no gaps", () => {
    // A missing slot means a mesh the user can click that resolves to nothing,
    // which is the exact failure this module exists to remove.
    for (const slot of SLOT_IDS) {
      expect(SLOT_COMPONENTS[slot], `no mapping for ${slot}`).toBeDefined();
    }
    expect(Object.keys(SLOT_COMPONENTS).sort()).toEqual([...SLOT_IDS].sort());
  });

  it("keeps left and right as distinct components", () => {
    // Collapsing a pair into one component halves the cost roll-up for every
    // paired part, so this is a correctness guard, not a naming preference.
    expect(SLOT_COMPONENTS.forearmL.componentName).not.toBe(SLOT_COMPONENTS.forearmR.componentName);
    expect(SLOT_COMPONENTS.forearmL.assembly).toBe("ARM_LEFT");
    expect(SLOT_COMPONENTS.forearmR.assembly).toBe("ARM_RIGHT");
  });

  it("resolves the non-slot parts the helmet block draws", () => {
    for (const id of ["mask", "lensL", "lensR"] as const) {
      expect(specFor(id)?.assembly).toBe("HEAD");
    }
  });

  it("assigns every selectable id to a known assembly", () => {
    for (const id of allSelectableIds()) {
      const spec = specFor(id);
      expect(spec).toBeDefined();
      expect(ASSEMBLY_ORDER).toContain(spec!.assembly);
    }
  });

  it("partitions ids across assemblies without loss or duplication", () => {
    const grouped = ASSEMBLY_ORDER.flatMap(idsInAssembly);
    expect(grouped.sort()).toEqual([...allSelectableIds()].sort());
  });

  it("names a manufacturing route the costing model recognises", () => {
    // A route the cost model does not know silently falls back to the default
    // multiplier, which would make a CNC part price like a sewn one.
    for (const id of allSelectableIds()) {
      expect(PROCESS_MULTIPLIER[specFor(id)!.manufacturing]).toBeGreaterThan(0);
    }
  });
});

describe("component costing", () => {
  const material = { costPerKgUsd: 40, name: "Aramid laminate" };

  it("derives cost from mass and material price", () => {
    const line = costComponent({
      id: "c1", name: "Chest Plate", subsystem: "COMPOSITE_LAYUP",
      massKg: 0.5, costUsd: null, confidence: "MEDIUM", material,
    });
    expect(line.basis).toBe("DERIVED");
    expect(line.materialUsd).toBeCloseTo(20);
    // 0.5kg × $40 × 5.4 layup multiplier
    expect(line.totalUsd).toBeCloseTo(108);
    expect(line.note).toContain("ESTIMATED");
  });

  it("never overwrites an explicitly recorded cost with an estimate", () => {
    const line = costComponent({
      id: "c2", name: "Power Core", subsystem: "CNC",
      massKg: 0.5, costUsd: 380, confidence: "HIGH", material,
    });
    expect(line.basis).toBe("STORED");
    expect(line.totalUsd).toBe(380);
    expect(line.processMultiplier).toBeNull();
  });

  it("reports a missing input rather than costing it as zero", () => {
    const noMass = costComponent({
      id: "c3", name: "Sensor", subsystem: null,
      massKg: null, costUsd: null, confidence: null, material,
    });
    expect(noMass.basis).toBe("UNKNOWN");
    expect(noMass.totalUsd).toBeNull();
    expect(noMass.note).toContain("no mass");

    const noPrice = costComponent({
      id: "c4", name: "Sensor", subsystem: null,
      massKg: 0.1, costUsd: null, confidence: null,
      material: { costPerKgUsd: null, name: "Unknown" },
    });
    expect(noPrice.basis).toBe("UNKNOWN");
    expect(noPrice.totalUsd).toBeNull();
  });

  it("prices the same mass differently by manufacturing route", () => {
    const asSewn = costComponent({
      id: "c5", name: "X", subsystem: "CUT_AND_SEW", massKg: 1, costUsd: null, confidence: null, material,
    });
    const asMachined = costComponent({
      id: "c6", name: "X", subsystem: "CNC", massKg: 1, costUsd: null, confidence: null, material,
    });
    expect(asMachined.totalUsd!).toBeGreaterThan(asSewn.totalUsd!);
  });

  it("carries the component's own confidence through untouched", () => {
    const line = costComponent({
      id: "c7", name: "X", subsystem: "THERMOFORM", massKg: 0.2, costUsd: null, confidence: "LOW", material,
    });
    expect(line.confidence).toBe("LOW");
  });
});
