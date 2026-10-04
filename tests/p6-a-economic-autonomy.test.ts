/**
 * [P6-A] THE ECONOMIC AUTONOMY FOUNDATION — adversarial tests.
 *
 * P5-D through P5-G asked whether a number nobody measured could become
 * evidence. This phase asks the forecasting version, which is harder because
 * every input is legitimately uncertain:
 *
 *   Can an opportunity nobody researched be ranked?
 *   Can a model's invented figure move money?
 *   Can an estimate reach the ledger?
 *   Can a prediction be revised once the answer is in sight?
 *   Can a system that has never been right claim to be calibrated?
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import {
  CAPITAL_MINIMUM_BASIS,
  describeBasis,
  fromNullable,
  known,
  meetsMinimumBasis,
  unknown,
  weakerBasis,
  weakestBasis,
  type Estimate,
} from "@/lib/economic/estimate";
import { projectOpportunity, type OpportunityModelView } from "@/lib/economic/opportunityModel";
import {
  expectedValueOf,
  isRankable,
  opportunityCostPerDayCents,
  rankByExpectedValue,
  MAX_HORIZON_DAYS,
} from "@/lib/economic/expectedValue";
import {
  concentrationOf,
  selectPortfolio,
  MAX_CONCURRENT_EXPERIMENTS,
  MIN_ALLOCATION_CENTS,
} from "@/lib/economic/portfolio";
import { CONCENTRATION_FRACTION, RESERVE_FRACTION } from "@/lib/volara/governor";
import {
  getCalibration,
  predictionDigest,
  recordPrediction,
  reconcilePrediction,
  MIN_CALIBRATION_SAMPLE,
} from "@/lib/economic/calibration";
import { nextBestEconomicAction } from "@/lib/economic/nextAction";
import { createTestUser } from "./helpers";
import type { Opportunity, User } from "@/generated/prisma/client";

let user: User;

beforeAll(async () => {
  user = await createTestUser();
});

/** A bare Opportunity row shape — every economic dimension null unless given. */
function opportunityRow(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `opp-${Math.random().toString(36).slice(2)}`,
    userId: user.id,
    objectiveId: "obj",
    title: "An opportunity",
    description: null,
    estimatedValue: null,
    effort: null,
    confidence: "LOW",
    risk: null,
    nextAction: null,
    evidence: null,
    status: "IDEA",
    projectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: null,
    source: null,
    discoveredAt: new Date(),
    estimatedStartupCost: null,
    estimatedOperatingCost: null,
    estimatedMargin: null,
    estimatedTimeToRevenueDays: null,
    complexity: null,
    competition: null,
    scalability: null,
    requiredHumanInvolvement: null,
    requiredCapabilities: null,
    dependencies: null,
    rationale: null,
    scoreSnapshot: null,
    scoreBreakdown: null,
    discoveredByAgentId: null,
    strategyId: null,
    participatingAgentIds: "[]",
    requiredCapitalCents: null,
    expectedRevenueCents: null,
    expectedProfitCents: null,
    probabilityOfSuccess: null,
    maxLossCents: null,
    downside: null,
    timeToPayoutDays: null,
    requiredTools: null,
    policyStatus: null,
    correlationId: null,
    ...over,
  } as Opportunity;
}

/** A fully-specified, rankable, capital-eligible opportunity. */
function fundable(over: Partial<Opportunity> = {}): OpportunityModelView {
  return projectOpportunity(
    opportunityRow({
      expectedProfitCents: 100_000,
      requiredCapitalCents: 20_000,
      probabilityOfSuccess: 0.5,
      maxLossCents: 20_000,
      timeToPayoutDays: 30,
      ...over,
    }),
    null
  );
}

// ---------------------------------------------------------------------------
// The estimate: an unknown carries no value
// ---------------------------------------------------------------------------

describe("an unknown quantity has no value to read", () => {
  it("a known estimate carries its value, basis and provenance", () => {
    const e = known(1234, "MEASURED", "the store said so");
    expect(e.known).toBe(true);
    expect(e.value).toBe(1234);
    expect(e.basis).toBe("MEASURED");
  });

  it("AN UNKNOWN HAS NO VALUE FIELD AT ALL", () => {
    // The whole safeguard. There is nothing for `?? 0` to read, so substituting
    // a default has to be written deliberately rather than happening in passing.
    const e = unknown("nobody has researched this");
    expect(e.known).toBe(false);
    expect("value" in e).toBe(false);
    expect(e.basis).toBe("NONE");
  });

  it("lifts a null column to unknown rather than to a default", () => {
    const e = fromNullable(null, "RECORDED", "a column", "it was never set");
    expect(e.known).toBe(false);
    expect("value" in e).toBe(false);
    // And a zero is a real value, not an absence — the distinction P5-E made
    // for observations, applied to estimates.
    const zero = fromNullable(0, "RECORDED", "a column", "it was never set");
    expect(zero.known).toBe(true);
    expect(zero.known && zero.value).toBe(0);
  });

  it("takes the WEAKER basis when combining, never the stronger", () => {
    expect(weakerBasis("MEASURED", "MODEL_SUGGESTED")).toBe("MODEL_SUGGESTED");
    expect(weakerBasis("RECORDED", "COMPARABLE")).toBe("COMPARABLE");
    expect(weakerBasis("NONE", "MEASURED")).toBe("NONE");
  });

  it("a derived figure is only as good as its worst input", () => {
    const estimates: Estimate<number>[] = [
      known(1, "MEASURED", "a"),
      known(2, "MEASURED", "b"),
      known(3, "MODEL_SUGGESTED", "a model guessed"),
    ];
    // Not an average of ranks — the weakest. Averaging would let two measured
    // inputs launder one invented one.
    expect(weakestBasis(estimates)).toBe("MODEL_SUGGESTED");
  });

  it("a figure derived from nothing is not well-founded", () => {
    expect(weakestBasis([])).toBe("NONE");
  });

  it("A MODEL'S NUMBER IS BELOW THE CAPITAL MINIMUM", () => {
    // The single most important comparison in the module.
    expect(meetsMinimumBasis("MODEL_SUGGESTED", CAPITAL_MINIMUM_BASIS)).toBe(false);
    expect(meetsMinimumBasis("NONE", CAPITAL_MINIMUM_BASIS)).toBe(false);
    expect(meetsMinimumBasis("COMPARABLE", CAPITAL_MINIMUM_BASIS)).toBe(true);
    expect(meetsMinimumBasis("RECORDED", CAPITAL_MINIMUM_BASIS)).toBe(true);
    expect(meetsMinimumBasis("MEASURED", CAPITAL_MINIMUM_BASIS)).toBe(true);
  });

  it("describes a basis by what it is, not by how confident it sounds", () => {
    expect(describeBasis("MODEL_SUGGESTED")).toMatch(/nothing corroborating/i);
    expect(describeBasis("NONE")).toMatch(/not known/i);
    expect(describeBasis("MEASURED")).toMatch(/external system of record/i);
  });
});

// ---------------------------------------------------------------------------
// The common model
// ---------------------------------------------------------------------------

describe("every opportunity is projected onto the same dimensions", () => {
  it("a bare opportunity has NO dimension silently filled in", () => {
    const model = projectOpportunity(opportunityRow(), null);
    for (const [name, dimension] of Object.entries(model.dimensions)) {
      expect(dimension.known, name).toBe(false);
    }
    expect(model.monetaryBasis).toBe("NONE");
    expect(model.missing.length).toBe(Object.keys(model.dimensions).length);
  });

  it("normalizes completely different kinds identically", () => {
    // The point of a common model: the category is free text and changes
    // nothing about how the dimensions are read.
    const dropship = fundable({ category: "dropshipping" });
    const saas = fundable({ category: "micro-saas" });
    expect(Object.keys(dropship.dimensions)).toEqual(Object.keys(saas.dimensions));
    expect(dropship.category).toBe("dropshipping");
    expect(saas.category).toBe("micro-saas");
  });

  it("prefers VOX's OWN measured probability over a stated one", () => {
    const model = projectOpportunity(
      opportunityRow({ probabilityOfSuccess: 0.9 }),
      { probability: 0.25, decided: 4 }
    );
    expect(model.dimensions.probabilityOfSuccess.known).toBe(true);
    expect(model.dimensions.probabilityOfSuccess.known && model.dimensions.probabilityOfSuccess.value).toBe(0.25);
    // MEASURED, and that is what lifts the whole monetary basis.
    expect(model.dimensions.probabilityOfSuccess.basis).toBe("MEASURED");
  });

  it("does NOT treat a probability over zero trials as measured", () => {
    // `getMeasuredProbability()` returns null with nothing decided, and null
    // must stay null — 0.5 here would be the default-for-unknown bug returning.
    const model = projectOpportunity(opportunityRow(), { probability: null, decided: 0 });
    expect(model.dimensions.probabilityOfSuccess.known).toBe(false);
  });

  it("derives profit from revenue AND margin, inheriting the weaker basis", () => {
    const model = projectOpportunity(
      opportunityRow({ expectedRevenueCents: 200_000, estimatedMargin: 0.25 }),
      null
    );
    expect(model.dimensions.expectedProfitCents.known).toBe(true);
    expect(model.dimensions.expectedProfitCents.known && model.dimensions.expectedProfitCents.value).toBe(50_000);
  });

  it("refuses to derive profit from revenue alone", () => {
    // Deriving without a margin means assuming one, and an assumed margin is
    // the difference between a business and a hobby.
    const model = projectOpportunity(opportunityRow({ expectedRevenueCents: 200_000 }), null);
    expect(model.dimensions.expectedProfitCents.known).toBe(false);
    expect(model.missing).toContain("expectedProfitCents");
  });

  it("an assessed ordinal cannot lift the monetary basis", () => {
    // scalability being known says nothing about whether the money figures are.
    const model = projectOpportunity(opportunityRow({ scalability: "HIGH", competition: "LOW" }), null);
    expect(model.dimensions.scalability.known).toBe(true);
    expect(model.monetaryBasis).toBe("NONE");
  });
});

// ---------------------------------------------------------------------------
// Expected value
// ---------------------------------------------------------------------------

describe("expected net profit, or an explicit refusal to rank", () => {
  it("REFUSES TO RANK AN UNRESEARCHED OPPORTUNITY", () => {
    // The flaw this phase exists to fix: `scoreOpportunity()` would score this
    // using `estimatedValue ?? 1`, producing a plain number that sorts beside
    // researched ones.
    const expectation = expectedValueOf(projectOpportunity(opportunityRow(), null));
    expect(expectation.rankable).toBe(false);
    if (expectation.rankable) return;
    expect(expectation.missing).toEqual(
      expect.arrayContaining(["probabilityOfSuccess", "expectedProfitCents", "maxLossCents"])
    );
  });

  it("the unrankable arm carries nothing to sort on", () => {
    const expectation = expectedValueOf(projectOpportunity(opportunityRow(), null));
    expect("expectedNetCents" in expectation).toBe(false);
    expect("expectedNetPerDayCents" in expectation).toBe(false);
  });

  it("names exactly which dimension is missing", () => {
    const expectation = expectedValueOf(
      projectOpportunity(
        opportunityRow({ expectedProfitCents: 10_000, probabilityOfSuccess: 0.5 }),
        null
      )
    );
    expect(expectation.rankable).toBe(false);
    if (expectation.rankable) return;
    expect(expectation.missing).toEqual(["maxLossCents"]);
  });

  it("SUBTRACTS THE DOWNSIDE — expectation is not just the upside", () => {
    // p × profit − (1−p) × loss. Omitting the second term is how a 2% moonshot
    // outranks a reliable small win.
    const expectation = expectedValueOf(fundable());
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    // 0.5 × 100000 − 0.5 × 20000 = 40000
    expect(expectation.expectedNetCents).toBe(40_000);
  });

  it("a bad bet produces a NEGATIVE expectation rather than a small positive one", () => {
    const expectation = expectedValueOf(
      fundable({ probabilityOfSuccess: 0.05, expectedProfitCents: 50_000, maxLossCents: 40_000 })
    );
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    // 0.05 × 50000 − 0.95 × 40000 = 2500 − 38000
    expect(expectation.expectedNetCents).toBeLessThan(0);
  });

  it("expresses the rate per day so horizons are comparable", () => {
    const fast = expectedValueOf(fundable({ timeToPayoutDays: 7 }));
    const slow = expectedValueOf(fundable({ timeToPayoutDays: 90 }));
    expect(fast.rankable && slow.rankable).toBe(true);
    if (!fast.rankable || !slow.rankable) return;
    // Same total expectation, very different rate.
    expect(fast.expectedNetCents).toBe(slow.expectedNetCents);
    expect(fast.expectedNetPerDayCents).toBeGreaterThan(slow.expectedNetPerDayCents);
  });

  it("an unknown horizon is CONSERVATIVE, not flattering", () => {
    const expectation = expectedValueOf(fundable({ timeToPayoutDays: null, estimatedTimeToRevenueDays: null }));
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    // The longest horizon considered, which understates the rate rather than
    // overstating it. The one default in the module, chosen in that direction.
    expect(expectation.terms.horizonDays).toBe(MAX_HORIZON_DAYS);
  });

  it("never divides by zero on a same-day opportunity", () => {
    const expectation = expectedValueOf(fundable({ timeToPayoutDays: 0 }));
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    expect(Number.isFinite(expectation.expectedNetPerDayCents)).toBe(true);
  });

  it("return on capital is NULL rather than Infinity when capital is unknown or zero", () => {
    const noCapital = expectedValueOf(fundable({ requiredCapitalCents: null }));
    const zeroCapital = expectedValueOf(fundable({ requiredCapitalCents: 0 }));
    expect(noCapital.rankable && noCapital.expectedReturnOnCapital).toBeNull();
    expect(zeroCapital.rankable && zeroCapital.expectedReturnOnCapital).toBeNull();
  });

  it("carries the weakest basis and says so in its own summary", () => {
    const expectation = expectedValueOf(fundable());
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    expect(expectation.summary).toMatch(/estimate, not revenue/i);
    expect(expectation.basis).toBe("RECORDED");
  });

  it("ranks by rate and keeps the unrankable OUT of the ordering", () => {
    const good = expectedValueOf(fundable({ expectedProfitCents: 500_000, timeToPayoutDays: 7 }));
    const poor = expectedValueOf(fundable({ expectedProfitCents: 30_000, timeToPayoutDays: 90 }));
    const bare = expectedValueOf(projectOpportunity(opportunityRow(), null));

    const { ranked, unrankable } = rankByExpectedValue([poor, bare, good]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].expectedNetPerDayCents).toBeGreaterThanOrEqual(ranked[1].expectedNetPerDayCents);
    // Not sorted last — sorted nowhere. "Unknown" is not "worse".
    expect(unrankable).toHaveLength(1);
  });

  it("is deterministic — identical inputs rank identically", () => {
    const a = expectedValueOf(fundable());
    const b = expectedValueOf(fundable());
    const first = rankByExpectedValue([a, b]).ranked.map((e) => e.opportunityId);
    const second = rankByExpectedValue([a, b]).ranked.map((e) => e.opportunityId);
    expect(first).toEqual(second);
  });

  it("reports opportunity cost against the best alternative", () => {
    const best = expectedValueOf(fundable({ expectedProfitCents: 500_000, timeToPayoutDays: 7 }));
    const chosen = expectedValueOf(fundable({ expectedProfitCents: 60_000, timeToPayoutDays: 30 }));
    expect(best.rankable && chosen.rankable).toBe(true);
    if (!best.rankable || !chosen.rankable) return;
    expect(opportunityCostPerDayCents(chosen, [best, chosen])).toBeGreaterThan(0);
    // With no alternative the cost is zero — a real answer, not a missing one.
    expect(opportunityCostPerDayCents(chosen, [chosen])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The portfolio
// ---------------------------------------------------------------------------

describe("the portfolio is bounded by capital, attention and evidence", () => {
  const deployable = 1_000_000; // $10,000

  function plan(expectations: ReturnType<typeof expectedValueOf>[], over: Partial<Parameters<typeof selectPortfolio>[0]> = {}) {
    return selectPortfolio({ expectations, deployableCents: deployable, activeExperiments: 0, halted: false, ...over });
  }

  it("keeps the governor's reserve back rather than planning to spend the last cent", () => {
    const p = plan([]);
    expect(p.limits.reservedCents).toBe(Math.round(deployable * RESERVE_FRACTION));
    expect(p.limits.allocatableCents).toBe(deployable - p.limits.reservedCents);
  });

  it("reuses the governor's own concentration fraction, not a second copy", () => {
    const p = plan([]);
    expect(p.limits.concentrationCapCents).toBe(Math.round(p.limits.allocatableCents * CONCENTRATION_FRACTION));
  });

  it("selects a good opportunity and proposes its capital", () => {
    const p = plan([expectedValueOf(fundable())]);
    expect(p.selected).toHaveLength(1);
    expect(p.selected[0].proposedCapitalCents).toBe(20_000);
    expect(p.proposedTotalCents).toBe(20_000);
  });

  it("NEVER selects a negative expectation, even with capital to spare", () => {
    const bad = expectedValueOf(
      fundable({ probabilityOfSuccess: 0.05, expectedProfitCents: 10_000, maxLossCents: 50_000 })
    );
    const p = plan([bad]);
    expect(p.selected).toHaveLength(0);
    expect(p.deferred[0].reason).toBe("NEGATIVE_EXPECTATION");
  });

  it("A MODEL'S NUMBERS NEVER RESERVE MONEY", () => {
    // The central guard of the phase. The figures are excellent; the basis is
    // a model's unsupported proposal; the answer is corroborate, not fund.
    const modelOnly = fundable();
    const weakened: OpportunityModelView = {
      ...modelOnly,
      monetaryBasis: "MODEL_SUGGESTED",
    };
    const expectation = expectedValueOf(weakened);
    expect(expectation.rankable && expectation.capitalEligible).toBe(false);

    const p = plan([expectation]);
    expect(p.selected).toHaveLength(0);
    expect(p.deferred[0].reason).toBe("BASIS_TOO_WEAK");
    expect(p.proposedTotalCents).toBe(0);
  });

  it("refuses an opportunity whose appetite exceeds the concentration cap", () => {
    const p = plan([expectedValueOf(fundable({ requiredCapitalCents: deployable }))]);
    expect(p.selected).toHaveLength(0);
    expect(p.deferred[0].reason).toBe("EXCEEDS_CONCENTRATION_CAP");
  });

  it("stops when capital is exhausted and says so", () => {
    // Each wants exactly the cap, so the second cannot be funded.
    const each = Math.round(deployable * (1 - RESERVE_FRACTION) * CONCENTRATION_FRACTION);
    const p = plan([
      expectedValueOf(fundable({ requiredCapitalCents: each, expectedProfitCents: 900_000, timeToPayoutDays: 7 })),
      expectedValueOf(fundable({ requiredCapitalCents: each, expectedProfitCents: 800_000, timeToPayoutDays: 7 })),
      expectedValueOf(fundable({ requiredCapitalCents: each, expectedProfitCents: 700_000, timeToPayoutDays: 7 })),
    ]);
    expect(p.proposedTotalCents).toBeLessThanOrEqual(p.limits.allocatableCents);
    expect(p.deferred.some((d) => d.reason === "CAPITAL_EXHAUSTED")).toBe(true);
  });

  it("N IS DERIVED, NOT HARDCODED — concurrency binds before capital here", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      expectedValueOf(fundable({ requiredCapitalCents: 1_000, expectedProfitCents: 100_000 + i, timeToPayoutDays: 7 }))
    );
    const p = plan(many);
    expect(p.selected.length).toBe(MAX_CONCURRENT_EXPERIMENTS);
    expect(p.deferred.some((d) => d.reason === "CONCURRENCY_REACHED")).toBe(true);
  });

  it("counts already-running experiments against the concurrency limit", () => {
    const many = Array.from({ length: 6 }, () => expectedValueOf(fundable({ requiredCapitalCents: 1_000 })));
    const p = plan(many, { activeExperiments: MAX_CONCURRENT_EXPERIMENTS });
    expect(p.selected).toHaveLength(0);
    expect(p.limits.concurrencySlots).toBe(0);
  });

  it("proposes zero capital for an opportunity that explicitly needs none", () => {
    const p = plan([expectedValueOf(fundable({ requiredCapitalCents: 0 }))]);
    expect(p.selected).toHaveLength(1);
    expect(p.selected[0].proposedCapitalCents).toBe(0);
  });

  it("AN UNKNOWN CAPITAL REQUIREMENT IS NOT A ZERO ONE", () => {
    // Found by a test written loosely enough to catch it: `requiredCapitalCents: null`
    // means "nobody has worked out what this costs", which is a real gap, and
    // funding it would be committing to an unknown bill. It weakens the
    // monetary basis to NONE and is routed to corroboration instead.
    const p = plan([expectedValueOf(fundable({ requiredCapitalCents: null }))]);
    expect(p.selected).toHaveLength(0);
    expect(p.deferred[0].reason).toBe("BASIS_TOO_WEAK");
  });

  it("refuses a slice below the minimum worth proposing", () => {
    const p = plan([expectedValueOf(fundable({ requiredCapitalCents: MIN_ALLOCATION_CENTS - 1 }))]);
    expect(p.deferred[0].reason).toBe("BELOW_MINIMUM_ALLOCATION");
  });

  it("A HALT STOPS EVERYTHING NEW", () => {
    const p = plan([expectedValueOf(fundable())], { halted: true });
    expect(p.selected).toHaveLength(0);
    expect(p.deferred.every((d) => d.reason === "HALTED")).toBe(true);
    expect(p.proposedTotalCents).toBe(0);
  });

  it("with no deployable capital, nothing is proposed", () => {
    const p = plan([expectedValueOf(fundable())], { deployableCents: 0 });
    expect(p.selected).toHaveLength(0);
    expect(p.limits.allocatableCents).toBe(0);
  });

  it("every deferral names its binding reason", () => {
    const p = plan([
      expectedValueOf(fundable({ probabilityOfSuccess: 0.01, maxLossCents: 100_000 })),
      expectedValueOf(fundable({ requiredCapitalCents: deployable })),
    ]);
    for (const d of p.deferred) {
      expect(d.reason).toBeTruthy();
      expect(d.detail.length).toBeGreaterThan(20);
    }
  });

  it("the unrankable are reported separately, as research rather than rejection", () => {
    const p = plan([expectedValueOf(projectOpportunity(opportunityRow(), null))]);
    expect(p.unrankable).toHaveLength(1);
    expect(p.selected).toHaveLength(0);
    expect(p.deferred).toHaveLength(0);
  });

  it("reports concentration across what was actually selected", () => {
    const p = plan([
      expectedValueOf(fundable({ requiredCapitalCents: 300_000, expectedProfitCents: 900_000, timeToPayoutDays: 7 })),
      expectedValueOf(fundable({ requiredCapitalCents: 10_000, expectedProfitCents: 100_000, timeToPayoutDays: 30 })),
    ]);
    const c = concentrationOf(p);
    expect(c.maxShare).toBeGreaterThan(0.5);
    expect(c.opportunityId).toBeTruthy();
    // An empty plan has no concentration, not a divide-by-zero.
    expect(concentrationOf(plan([])).maxShare).toBe(0);
  });

  it("never proposes more than it is allowed to allocate", () => {
    const many = Array.from({ length: 20 }, () =>
      expectedValueOf(fundable({ requiredCapitalCents: 100_000, expectedProfitCents: 900_000, timeToPayoutDays: 7 }))
    );
    const p = plan(many);
    expect(p.proposedTotalCents).toBeLessThanOrEqual(p.limits.allocatableCents);
  });
});

// ---------------------------------------------------------------------------
// Prediction and calibration
// ---------------------------------------------------------------------------

describe("a prediction is frozen, and scored only against the ledger", () => {
  async function seedOpportunity(owner: User) {
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Make money" } });
    return db.opportunity.create({
      data: { userId: owner.id, objectiveId: objective.id, title: `O ${Math.random()}` },
    });
  }

  async function seedExperimentWithLedger(owner: User, revenueCents: number, expenseCents: number) {
    const asset = await db.economicAsset.create({
      data: { userId: owner.id, name: `A ${Math.random()}`, category: "OTHER" },
    });
    if (revenueCents > 0) {
      await db.economicRevenue.create({
        data: { assetId: asset.id, amountUsd: revenueCents / 100, amountCents: revenueCents, occurredAt: new Date() },
      });
    }
    if (expenseCents > 0) {
      await db.economicExpense.create({
        data: { assetId: asset.id, amountUsd: expenseCents / 100, amountCents: expenseCents, occurredAt: new Date() },
      });
    }
    return db.experiment.create({
      data: { userId: owner.id, hypothesis: `H ${Math.random()}`, economicAssetId: asset.id },
    });
  }

  it("records a prediction with its basis frozen", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const result = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      predictedNetCents: 50_000,
      predictedProbability: 0.4,
      predictedBasis: "RECORDED",
      horizonDays: 30,
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    expect(result.prediction.predictedBasis).toBe("RECORDED");
    expect(result.prediction.observedNetCents).toBeNull();
  });

  it("REFUSES A SECOND PREDICTION FOR THE SAME EXPERIMENT", async () => {
    // A prediction revisable once the answer is in sight is not a prediction,
    // and a calibration over revisable predictions measures nothing.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const experiment = await seedExperimentWithLedger(owner, 0, 0);

    const first = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 50_000,
      predictedProbability: 0.4,
      predictedBasis: "RECORDED",
      horizonDays: 30,
    });
    expect(first.recorded).toBe(true);

    const second = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 1_000,
      predictedProbability: 0.9,
      predictedBasis: "RECORDED",
      horizonDays: 30,
    });
    expect(second.recorded).toBe(false);
    expect(second.recorded === false && second.reason).toBe("ALREADY_PREDICTED");
  });

  it("refuses a prediction resting on no basis at all", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const result = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      predictedNetCents: 1,
      predictedProbability: 0.5,
      predictedBasis: "NONE",
      horizonDays: 1,
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("INVALID_PREDICTION");
  });

  it("refuses a malformed prediction", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    for (const bad of [
      { predictedProbability: 1.5 },
      { predictedProbability: -0.1 },
      { horizonDays: 0 },
      { predictedNetCents: 1.5 },
    ]) {
      const result = await recordPrediction({
        userId: owner.id,
        opportunityId: opportunity.id,
        predictedNetCents: 1_000,
        predictedProbability: 0.5,
        predictedBasis: "RECORDED",
        horizonDays: 7,
        ...bad,
      });
      expect(result.recorded, JSON.stringify(bad)).toBe(false);
    }
  });

  it("cannot predict against another user's opportunity", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const result = await recordPrediction({
      userId: stranger.id,
      opportunityId: opportunity.id,
      predictedNetCents: 1_000,
      predictedProbability: 0.5,
      predictedBasis: "RECORDED",
      horizonDays: 7,
    });
    expect(result.recorded === false && result.reason).toBe("OPPORTUNITY_NOT_FOUND");
  });

  it("the digest changes when any predicted term changes", () => {
    const base = {
      opportunityId: "o1",
      predictedNetCents: 50_000,
      predictedProbability: 0.4,
      predictedBasis: "RECORDED",
      horizonDays: 30,
    };
    const original = predictionDigest(base);
    expect(predictionDigest(base)).toBe(original);
    for (const m of [
      { predictedNetCents: 50_001 },
      { predictedProbability: 0.41 },
      { predictedBasis: "MEASURED" },
      { horizonDays: 31 },
      { opportunityId: "o2" },
    ]) {
      expect(predictionDigest({ ...base, ...m }), JSON.stringify(m)).not.toBe(original);
    }
  });

  it("SCORES AGAINST THE LEDGER, not against another estimate", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const experiment = await seedExperimentWithLedger(owner, 30_000, 10_000);
    const recorded = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 50_000,
      predictedProbability: 0.5,
      predictedBasis: "RECORDED",
      horizonDays: 30,
    });
    if (!recorded.recorded) throw new Error("fixture failed");

    const result = await reconcilePrediction(owner.id, recorded.prediction.id);
    expect(result.reconciled).toBe(true);
    if (!result.reconciled) return;
    // 30000 revenue − 10000 expenses = 20000 observed against 50000 predicted.
    expect(result.observedNetCents).toBe(20_000);
    expect(result.errorCents).toBe(-30_000);

    const row = await db.profitPrediction.findUnique({ where: { id: recorded.prediction.id } });
    expect(row?.outcomeSource).toBe("LEDGER");
  });

  it("A ZERO LEDGER IS A REAL OUTCOME — that is how optimism gets caught", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const experiment = await seedExperimentWithLedger(owner, 0, 0);
    const recorded = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 100_000,
      predictedProbability: 0.8,
      predictedBasis: "MODEL_SUGGESTED",
      horizonDays: 14,
    });
    if (!recorded.recorded) throw new Error("fixture failed");

    const result = await reconcilePrediction(owner.id, recorded.prediction.id);
    expect(result.reconciled).toBe(true);
    if (!result.reconciled) return;
    expect(result.observedNetCents).toBe(0);
    expect(result.errorCents).toBe(-100_000);
  });

  it("NO LEDGER IS NOT A ZERO OUTCOME", async () => {
    // The P5-E distinction, applied here: OBSERVED ZERO and NOTHING TO OBSERVE
    // are different facts and must not collapse.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "no asset" },
    });
    const recorded = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 10_000,
      predictedProbability: 0.5,
      predictedBasis: "RECORDED",
      horizonDays: 7,
    });
    if (!recorded.recorded) throw new Error("fixture failed");

    const result = await reconcilePrediction(owner.id, recorded.prediction.id);
    expect(result.reconciled).toBe(false);
    expect(result.reconciled === false && result.reason).toBe("NO_LEDGER");
    const row = await db.profitPrediction.findUnique({ where: { id: recorded.prediction.id } });
    expect(row?.observedNetCents).toBeNull();
    expect(row?.unresolvedReason).toBe("NO_LEDGER");
  });

  it("refuses to re-score a resolved prediction", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    const experiment = await seedExperimentWithLedger(owner, 5_000, 0);
    const recorded = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 5_000,
      predictedProbability: 0.5,
      predictedBasis: "RECORDED",
      horizonDays: 7,
    });
    if (!recorded.recorded) throw new Error("fixture failed");
    await reconcilePrediction(owner.id, recorded.prediction.id);
    const again = await reconcilePrediction(owner.id, recorded.prediction.id);
    expect(again.reconciled === false && again.reason).toBe("ALREADY_RESOLVED");
  });

  it("WITHHOLDS A CALIBRATION FACTOR BELOW THE MINIMUM SAMPLE", async () => {
    // A factor from two data points would be applied to every future forecast
    // with the authority of statistics.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    for (let i = 0; i < 2; i++) {
      const experiment = await seedExperimentWithLedger(owner, 1_000, 0);
      const r = await recordPrediction({
        userId: owner.id,
        opportunityId: opportunity.id,
        experimentId: experiment.id,
        predictedNetCents: 10_000,
        predictedProbability: 0.5,
        predictedBasis: "MODEL_SUGGESTED",
        horizonDays: 7,
      });
      if (r.recorded) await reconcilePrediction(owner.id, r.prediction.id);
    }
    const calibration = await getCalibration(owner.id);
    expect(calibration.totalResolved).toBe(2);
    expect(calibration.insufficientSample).toBe(true);
    // NULL, never 1.0 — a factor of 1 asserts "perfectly calibrated".
    expect(calibration.overallFactor).toBeNull();
  });

  it("DETECTS SYSTEMATIC OPTIMISM once there is a sample", async () => {
    // The payoff of the whole phase: VOX learning that its own model-suggested
    // forecasts run far too high.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    for (let i = 0; i < MIN_CALIBRATION_SAMPLE; i++) {
      const experiment = await seedExperimentWithLedger(owner, 2_000, 0);
      const r = await recordPrediction({
        userId: owner.id,
        opportunityId: opportunity.id,
        experimentId: experiment.id,
        predictedNetCents: 20_000,
        predictedProbability: 0.6,
        predictedBasis: "MODEL_SUGGESTED",
        horizonDays: 14,
      });
      if (r.recorded) await reconcilePrediction(owner.id, r.prediction.id);
    }
    const calibration = await getCalibration(owner.id);
    expect(calibration.insufficientSample).toBe(false);
    expect(calibration.overallFactor).not.toBeNull();
    // Observed 2,000 against 20,000 predicted — a tenth.
    expect(calibration.overallFactor!).toBeCloseTo(0.1, 2);

    const modelBasis = calibration.byBasis.find((b) => b.basis === "MODEL_SUGGESTED")!;
    expect(modelBasis.resolved).toBe(MIN_CALIBRATION_SAMPLE);
    // Negative mean error means optimistic, which is the useful direction to know.
    expect(modelBasis.meanErrorCents!).toBeLessThan(0);
  });

  it("reports calibration per basis, so trust is answerable by source", async () => {
    const owner = await createTestUser();
    const calibration = await getCalibration(owner.id);
    const bases = calibration.byBasis.map((b) => b.basis);
    expect(bases).toEqual(["MODEL_SUGGESTED", "COMPARABLE", "RECORDED", "MEASURED"]);
    // NONE is absent: a prediction on no basis is never recorded.
    expect(bases).not.toContain("NONE");
  });

  it("is scoped per user", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const opportunity = await seedOpportunity(a);
    const experiment = await seedExperimentWithLedger(a, 1_000, 0);
    const r = await recordPrediction({
      userId: a.id,
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      predictedNetCents: 1_000,
      predictedProbability: 0.5,
      predictedBasis: "RECORDED",
      horizonDays: 7,
    });
    if (r.recorded) await reconcilePrediction(a.id, r.prediction.id);
    expect((await getCalibration(b.id)).totalResolved).toBe(0);
    // And one user cannot score another's prediction.
    if (r.recorded) {
      const cross = await reconcilePrediction(b.id, r.prediction.id);
      expect(cross.reconciled).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The one question
// ---------------------------------------------------------------------------

describe("what is the best action right now", () => {
  it("HOLDS with a stated reason when there is nothing on record", async () => {
    const owner = await createTestUser();
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("HOLD");
    expect(posture.recommendation.reason).toMatch(/no opportunities on record/i);
    // And it does not invent candidates to fill the list.
    expect(posture.counts.opportunitiesConsidered).toBe(0);
  });

  it("asks for RESEARCH when nothing can be ranked", async () => {
    const owner = await createTestUser();
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: { userId: owner.id, objectiveId: objective.id, title: "Unresearched idea" },
    });
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("RESEARCH_OPPORTUNITY");
    expect(posture.counts.unrankable).toBe(1);
    // Named as unknown rather than as low value.
    expect(posture.recommendation.reason).toMatch(/nobody knows what they are worth/i);
  });

  it("asks to CORROBORATE when the numbers rest on a model alone", async () => {
    const owner = await createTestUser();
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: objective.id,
        title: "Model-sourced idea",
        // Good figures, no credible source: `source` says a model proposed it.
        source: "vox.research",
        expectedProfitCents: 500_000,
        requiredCapitalCents: 10_000,
        probabilityOfSuccess: 0.6,
        maxLossCents: 10_000,
        timeToPayoutDays: 14,
      },
    });
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });

    const posture = await nextBestEconomicAction(owner.id);
    // The figures are excellent and nothing corroborates them, so the answer is
    // corroborate rather than fund. This is the guard being live rather than
    // theoretical: before `statedBasisFor()` existed, nothing could produce a
    // MODEL_SUGGESTED basis and these numbers would have been funded.
    expect(posture.recommendation.kind).toBe("CORROBORATE_OPPORTUNITY");
    expect(posture.recommendation.reason).toMatch(/not worth funding/i);
    expect(posture.plan.proposedTotalCents).toBe(0);
  });

  it("a human-recorded row with the same figures IS fundable", async () => {
    // The other half, so the previous test is about the BASIS and not about the
    // numbers: identical figures, different provenance, different decision.
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: objective.id,
        title: "Human-sourced idea",
        source: "user",
        expectedProfitCents: 500_000,
        requiredCapitalCents: 10_000,
        probabilityOfSuccess: 0.6,
        maxLossCents: 10_000,
        timeToPayoutDays: 14,
      },
    });
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("REQUEST_CAPITAL");
  });

  it("recommends capital through the EXISTING gated path, never executing", async () => {
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: objective.id,
        title: "Fundable",
        expectedProfitCents: 400_000,
        requiredCapitalCents: 20_000,
        probabilityOfSuccess: 0.5,
        maxLossCents: 20_000,
        timeToPayoutDays: 21,
      },
    });
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("REQUEST_CAPITAL");
    // It names the gated path and does not claim to have done anything.
    expect(posture.recommendation.path).toMatch(/requestCapital\(\).*ApprovalGrant/);
    // NOTHING was allocated.
    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.economicExpense.count()).toBeGreaterThanOrEqual(0);
  });

  it("HOLDS while the engine is halted", async () => {
    const owner = await createTestUser();
    await db.user.update({
      where: { id: owner.id },
      data: { maxAutonomousSpendUsd: 10_000, economicHaltedAt: new Date(), economicHaltReason: "manual stop" },
    });
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: objective.id,
        title: "Fundable but halted",
        expectedProfitCents: 400_000,
        requiredCapitalCents: 20_000,
        probabilityOfSuccess: 0.5,
        maxLossCents: 20_000,
        timeToPayoutDays: 21,
      },
    });
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("HOLD");
    expect(posture.recommendation.reason).toMatch(/halted/i);
    expect(posture.plan.proposedTotalCents).toBe(0);
  });

  it("declining every losing bet is reported as a decision, not an absence", async () => {
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: objective.id,
        title: "Bad bet",
        expectedProfitCents: 10_000,
        requiredCapitalCents: 5_000,
        probabilityOfSuccess: 0.02,
        maxLossCents: 50_000,
        timeToPayoutDays: 30,
      },
    });
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("HOLD");
    expect(posture.recommendation.reason).toMatch(/correct decision, not an absence/i);
  });

  it("always reports calibration, including that it has no basis yet", async () => {
    const owner = await createTestUser();
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.calibration.overallFactor).toBeNull();
    expect(posture.calibration.insufficientSample).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

describe("the forecast layer can never become the ledger", () => {
  const sources = {
    estimate: readFileSync("src/lib/economic/estimate.ts", "utf8"),
    model: readFileSync("src/lib/economic/opportunityModel.ts", "utf8"),
    ev: readFileSync("src/lib/economic/expectedValue.ts", "utf8"),
    portfolio: readFileSync("src/lib/economic/portfolio.ts", "utf8"),
    nextAction: readFileSync("src/lib/economic/nextAction.ts", "utf8"),
    calibration: readFileSync("src/lib/economic/calibration.ts", "utf8"),
  };

  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("NO ESTIMATE IS EVER WRITTEN TO THE LEDGER", () => {
    // `LedgerProvenance` has no PROJECTED member precisely so a forecast cannot
    // be summed into profit. Nothing in this layer may become the exception.
    for (const [name, source] of Object.entries(sources)) {
      const code = codeOnly(source);
      expect(code, `${name} creates revenue`).not.toMatch(/economicRevenue\.create/);
      expect(code, `${name} creates an expense`).not.toMatch(/economicExpense\.create/);
    }
  });

  it("the decision layer mints no permission and no approval", () => {
    for (const [name, source] of Object.entries(sources)) {
      const code = codeOnly(source);
      for (const forbidden of ["grantPermission", "createApprovalGrant", "consumeApprovalGrant"]) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("nothing in the decision layer allocates, spends or executes", () => {
    // Asserted on the IMPORTS rather than on the text. `nextAction.ts` names
    // `approveCapitalAllocation()` inside a human-readable `path` string — which
    // is exactly what it should do, since telling a person which gated path to
    // use is the module's whole job. A text scan flagged that string; what
    // actually matters is that the function is not reachable from here, and a
    // symbol that is never imported cannot be called.
    for (const [name, source] of Object.entries(sources)) {
      const imports = (codeOnly(source).match(/^import[\s\S]*?from\s+"[^"]+";/gm) ?? []).join("\n");
      for (const forbidden of [
        "approveCapitalAllocation",
        "recordPolicySpend",
        "requestCapital",
        "executeRun",
        "rejectCapitalAllocation",
      ]) {
        expect(imports, `${name} imports ${forbidden}`).not.toContain(forbidden);
      }
      // And no direct write to the allocation or ledger tables.
      const code = codeOnly(source);
      expect(code, `${name} writes an allocation`).not.toMatch(/capitalAllocation\.(create|update)/);
    }
  });

  it("contains no model call — a forecast is arithmetic, not prose", () => {
    for (const [name, source] of Object.entries(sources)) {
      const code = codeOnly(source);
      for (const forbidden of ["@anthropic-ai/sdk", "getAIProvider", "getResearchProvider"]) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the estimate module is a pure leaf with no imports", () => {
    expect(codeOnly(sources.estimate)).not.toMatch(/^import /m);
  });

  it("the unknown arm of Estimate declares no value", () => {
    const arm = sources.estimate.slice(
      sources.estimate.indexOf("interface UnknownEstimate"),
      sources.estimate.indexOf("\n}", sources.estimate.indexOf("interface UnknownEstimate"))
    );
    expect(arm).not.toMatch(/^\s+value[?]?:/m);
  });

  it("the unrankable arm of Expectation declares no sortable figure", () => {
    const arm = sources.ev.slice(
      sources.ev.indexOf("interface UnrankableExpectation"),
      sources.ev.indexOf("\n}", sources.ev.indexOf("interface UnrankableExpectation"))
    );
    for (const field of ["expectedNetCents", "expectedNetPerDayCents", "score"]) {
      expect(arm, field).not.toContain(field);
    }
  });

  it("the portfolio reuses the governor's constants rather than redeclaring them", () => {
    const code = codeOnly(sources.portfolio);
    expect(code).toContain("from \"@/lib/volara/governor\"");
    // No second copy of either fraction.
    expect(code).not.toMatch(/const\s+RESERVE_FRACTION\s*=/);
    expect(code).not.toMatch(/const\s+CONCENTRATION_FRACTION\s*=/);
  });

  it("does not reintroduce the default-for-unknown habit it exists to remove", () => {
    // The P6 modules must not contain the `?? 1` / `?? 0.15` shape that
    // `scoreOpportunity()` uses. `calibration.ts` is exempt on one line, where
    // `?? 0` sums a genuinely empty ledger aggregate — and it says so.
    for (const name of ["model", "ev", "portfolio"] as const) {
      const code = codeOnly(sources[name]);
      expect(code, name).not.toMatch(/\?\?\s*0\.\d/);
      expect(code, name).not.toMatch(/\?\?\s*1\b/);
    }
  });
});
