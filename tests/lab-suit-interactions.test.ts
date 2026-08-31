import { describe, it, expect, beforeAll } from "vitest";
import { recordSuitInteraction, isSuitInteraction, SUIT_INTERACTIONS, UnknownSuitError } from "@/lib/lab/interactions";
import { signalKindForEvent } from "@/lib/3d/signals";
import { createSuit } from "@/lib/lab/suits";
import { listRecentEvents } from "@/lib/observability/events";
import { suitInteractionSchema } from "@/lib/validation/labSchemas";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const STATS: SuitStatsInput = {
  stealth: 70, durability: 60, mobility: 80, stretchiness: 60, weightKg: 4.0, thermalLoadC: 30,
  protection: 40, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 20000, flexibility: 60, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40, confidence: "ESTIMATED",
};

describe("suit bay interactions", () => {
  let userId: string;
  let suitId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId, codename: "Interaction Subject", archetype: "Utility", stats: STATS });
    suitId = suit.id;
  });

  it("records a selection against the suit, with its codename in the payload", async () => {
    await recordSuitInteraction({ userId, type: "lab.suit.selected", suitId });

    const events = await listRecentEvents(userId, { subjectType: "LabSuit", subjectId: suitId });
    const selected = events.find((e) => e.type === "lab.suit.selected");
    expect(selected).toBeDefined();
    expect(selected?.payload).toContain("Interaction Subject");
  });

  it("refuses a suit id belonging to another user", async () => {
    const other = await createTestUser();
    const theirs = await createSuit({ userId: other.id, codename: "Theirs", archetype: "Stealth", stats: STATS });

    // Not "not found because it does not exist" — not found because it is not
    // this user's. The distinction must not be observable.
    await expect(
      recordSuitInteraction({ userId, type: "lab.suit.selected", suitId: theirs.id })
    ).rejects.toBeInstanceOf(UnknownSuitError);

    const leaked = await listRecentEvents(userId, { subjectType: "LabSuit", subjectId: theirs.id });
    expect(leaked).toHaveLength(0);
  });

  it("rejects an event type that is not in the registry", async () => {
    expect(isSuitInteraction("lab.suit.deleted")).toBe(false);
    await expect(
      // Deliberately bypassing the type system, the way a bad request would.
      recordSuitInteraction({ userId, type: "lab.suit.deleted" as never })
    ).rejects.toThrow(/unregistered/);
  });

  it("constrains the request schema to the same registry", () => {
    expect(suitInteractionSchema.safeParse({ type: "lab.suit.deleted" }).success).toBe(false);
    expect(suitInteractionSchema.safeParse({ type: "lab.assembly.exploded", amount: 1 }).success).toBe(true);
    // Separation is a fraction, not an arbitrary number.
    expect(suitInteractionSchema.safeParse({ type: "lab.assembly.exploded", amount: 4 }).success).toBe(false);
  });

  it("marks only equipping as consequential", async () => {
    await recordSuitInteraction({ userId, type: "lab.suit.equipped", suitId });
    const events = await listRecentEvents(userId, { subjectType: "LabSuit", subjectId: suitId });

    const equipped = events.find((e) => e.type === "lab.suit.equipped");
    const selected = events.find((e) => e.type === "lab.suit.selected");
    expect(equipped?.consequential).toBe(true);
    expect(selected?.consequential).toBe(false);
  });

  it("keeps view-only interactions out of the Brain's cognitive signal", () => {
    // Looking at a component is not the system thinking. These all live under
    // the `lab.` prefix, which otherwise classifies as execution, so this is
    // the assertion that stops a camera move from lighting up the Brain.
    expect(signalKindForEvent("lab.suit.selected")).toBeNull();
    expect(signalKindForEvent("lab.suit.deselected")).toBeNull();
    expect(signalKindForEvent("lab.component.selected")).toBeNull();
    expect(signalKindForEvent("lab.assembly.exploded")).toBeNull();
    expect(signalKindForEvent("lab.assembly.reassembled")).toBeNull();

    // Equipping changes which suit is active, so it does classify.
    expect(signalKindForEvent("lab.suit.equipped")).toBe("execution");
  });

  it("classifies every registered interaction deliberately", () => {
    // A new interaction added to the registry without a decision about whether
    // it is cognition would silently inherit the `lab.` prefix and start
    // driving the Brain. This fails until someone makes that call.
    const decided = new Set(["lab.suit.equipped"]);
    for (const type of SUIT_INTERACTIONS) {
      const kind = signalKindForEvent(type);
      if (decided.has(type)) expect(kind).not.toBeNull();
      else expect(kind).toBeNull();
    }
  });
});
