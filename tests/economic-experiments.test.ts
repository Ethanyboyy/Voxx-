import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  createEconomicExperiment,
  readyExperiment,
  updateEconomicExperiment,
  listEconomicExperiments,
  validateContract,
  toDecisionContract,
  REQUIRED_CONTRACT_TERMS,
} from "@/lib/economic/experiments";
import { createTestUser } from "./helpers";

/**
 * The contract is the thing that lets a scheduler act without a model in the
 * loop. These tests defend the property that makes that safe: an incomplete or
 * self-contradictory contract cannot reach the decision layer, and no blank is
 * ever filled in with an assumed default.
 */

let userId: string;

const COMPLETE = {
  hypothesis: "A $200 ad test on channel X returns above cost within 30 days",
  method: "Spend $200 across two creatives, measure attributed revenue daily",
  requiredCapitalUsd: 200,
  maxLossUsd: 200,
  successMetric: "Attributed revenue above $700 within 30 days",
  failureMetric: "Attributed revenue below $200 at day 30",
  deadlineAt: new Date("2026-12-01T00:00:00Z"),
  scaleCriteria: "Net above $500 with CAC under $40",
  scaleAtNetUsd: 500,
  killCriteria: "Net at or below -$150",
  killAtNetUsd: -150,
  expectedReturnUsd: 900,
  expectedNetProfitUsd: 700,
  requiredCapabilities: ["economic.spend"],
};

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
});

describe("createEconomicExperiment", () => {
  it("stores every economic term on the existing Experiment model", async () => {
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    expect(experiment.maxLossUsd).toBe(200);
    expect(experiment.scaleAtNetUsd).toBe(500);
    expect(experiment.killAtNetUsd).toBe(-150);
    expect(experiment.requiredCapabilities).toEqual(["economic.spend"]);
    // Same table as any other experiment — not a parallel subsystem.
    expect(await db.experiment.count({ where: { userId } })).toBe(1);
  });

  it("always starts DRAFT, even when the contract is already complete", async () => {
    // Writing a contract and arming it for an autonomous loop are separate
    // decisions; a complete contract must not go live the moment it is saved.
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    expect(experiment.executionStatus).toBe("DRAFT");
    expect(experiment.validation.executable).toBe(true);
  });

  it("records a real Event", async () => {
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    const event = await db.event.findFirst({
      where: { userId, type: "economic_experiment.created", subjectId: experiment.id },
    });
    expect(event).not.toBeNull();
  });
});

describe("validateContract", () => {
  it("names every missing term rather than assuming a default", async () => {
    const experiment = await createEconomicExperiment({ userId, hypothesis: "bare idea" });
    expect(experiment.validation.executable).toBe(false);
    expect(experiment.validation.missing.sort()).toEqual([...REQUIRED_CONTRACT_TERMS].sort());
  });

  it("rejects a maximum loss of zero — an experiment with no authorized downside", async () => {
    const row = await db.experiment.create({ data: { userId, ...COMPLETE, maxLossUsd: 0, requiredCapabilities: "[]" } });
    const validation = validateContract(row);
    expect(validation.executable).toBe(false);
    expect(validation.incoherent.join(" ")).toContain("greater than 0");
  });

  it("catches a kill threshold the loss cap would always beat", async () => {
    // Fully populated, and still unrunnable as written: the cap fires at -$50
    // so the -$200 kill threshold is dead text.
    const row = await db.experiment.create({
      data: { userId, ...COMPLETE, maxLossUsd: 50, killAtNetUsd: -200, requiredCapabilities: "[]" },
    });
    const validation = validateContract(row);
    expect(validation.executable).toBe(false);
    expect(validation.incoherent.join(" ")).toContain("unreachable");
  });

  it("catches a scale threshold at or below the kill threshold", async () => {
    const row = await db.experiment.create({
      data: { userId, ...COMPLETE, scaleAtNetUsd: -200, killAtNetUsd: -150, requiredCapabilities: "[]" },
    });
    expect(validateContract(row).executable).toBe(false);
  });

  it("accepts an explicitly empty capability list as a real statement", async () => {
    const row = await db.experiment.create({
      data: { userId, ...COMPLETE, requiredCapabilities: "[]" },
    });
    expect(validateContract(row).executable).toBe(true);
  });

  it("treats a malformed capability blob as missing, not as empty", async () => {
    const row = await db.experiment.create({
      data: { userId, ...COMPLETE, requiredCapabilities: "not json" },
    });
    expect(validateContract(row).missing).toContain("requiredCapabilities");
  });
});

describe("toDecisionContract", () => {
  it("returns null for an incomplete contract instead of defaulting a constraint", async () => {
    const row = await db.experiment.create({ data: { userId, hypothesis: "half-written" } });
    expect(toDecisionContract(row)).toBeNull();
  });

  it("hands the decision layer the exact stored numbers", async () => {
    const row = await db.experiment.create({ data: { userId, ...COMPLETE, requiredCapabilities: "[]" } });
    const contract = toDecisionContract(row);
    expect(contract).not.toBeNull();
    expect(contract!.maxLossUsd).toBe(200);
    expect(contract!.killAtNetUsd).toBe(-150);
    expect(contract!.deadlineAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("readyExperiment", () => {
  it("refuses an incomplete contract and says exactly what is unresolved", async () => {
    const experiment = await createEconomicExperiment({ userId, hypothesis: "bare idea" });
    await expect(readyExperiment(userId, experiment.id)).rejects.toThrow(/maxLossUsd/);
  });

  it("arms a complete contract and records a consequential Event", async () => {
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    const ready = await readyExperiment(userId, experiment.id);
    expect(ready.executionStatus).toBe("READY");

    const event = await db.event.findFirst({
      where: { userId, type: "economic_experiment.ready", subjectId: experiment.id },
    });
    expect(event?.consequential).toBe(true);
  });
});

describe("updateEconomicExperiment", () => {
  it("refuses to rewrite a killed contract's terms", async () => {
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    await db.experiment.update({ where: { id: experiment.id }, data: { executionStatus: "KILLED" } });
    // Editing the loss cap of a dead experiment would rewrite the record of
    // why it died.
    await expect(updateEconomicExperiment(userId, experiment.id, { maxLossUsd: 10_000 })).rejects.toThrow(/KILLED/);
  });

  it("scopes to the owner", async () => {
    const other = await createTestUser();
    const experiment = await createEconomicExperiment({ userId, ...COMPLETE });
    expect(await updateEconomicExperiment(other.id, experiment.id, { maxLossUsd: 5 })).toBeNull();
  });
});

describe("listEconomicExperiments", () => {
  it("returns economic contracts and leaves plain research experiments alone", async () => {
    await db.experiment.create({ data: { userId, hypothesis: "a research question, no money involved" } });
    await createEconomicExperiment({ userId, ...COMPLETE });

    const listed = await listEconomicExperiments(userId);
    expect(listed).toHaveLength(1);
    expect(listed[0].hypothesis).toBe(COMPLETE.hypothesis);
  });
});
