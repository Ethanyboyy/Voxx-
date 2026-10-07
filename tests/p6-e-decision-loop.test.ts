/**
 * [P6-E] THE DECISION THAT FOLLOWS A MEASUREMENT — adversarial tests.
 *
 * P6-D closed the loop to a measured, reconciled, ledger-backed result and
 * nothing consumed it. `DECIDE_EXPERIMENT` was a declared action kind with no
 * producer, `decide()` was reachable only from the autonomous tick, and
 * `deriveEvidenceStage()`'s terminal `RECONCILED` stage was read by nothing. So
 * VOX could measure and could not learn.
 *
 * The questions this suite asks:
 *
 *   Can a decision be recommended over a ledger nobody accepted?
 *   Does the human-facing decision read the same ledger the tick does?
 *   Does a SCALE stay a recommendation?
 *   Does asking for a decision change anything?
 *   Can an unrelated measurement be auto-applied as a comparable?
 *   Is an empty ledger reported as a real zero rather than a gap?
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import {
  comparableCandidates,
  experimentDecisionState,
} from "@/lib/economic/experimentDecision";
import { decide } from "@/lib/economic/decide";
import { measureExperiment } from "@/lib/economic/scheduler";
import { toDecisionContract } from "@/lib/economic/experiments";
import { reconcileExperimentOutcome, getMeasuredProbability } from "@/lib/economic/probability";
import { nextBestEconomicAction } from "@/lib/economic/nextAction";
import { recordOperatorOutcome, predictExperimentOutcome } from "@/lib/economic/measurementLoop";
import { listEstimates, recordEstimate, upgradeEstimate } from "@/lib/economic/provenance";
import { getOpportunityModel } from "@/lib/economic/opportunityModel";
import { haltEconomicEngine } from "@/lib/economic/halt";
import { createTestUser } from "./helpers";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { User } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIGURES: Readonly<Record<EconomicFigure, number>> = Object.freeze({
  REQUIRED_CAPITAL_CENTS: 10_000,
  EXPECTED_REVENUE_CENTS: 80_000,
  EXPECTED_PROFIT_CENTS: 50_000,
  MAX_LOSS_CENTS: 10_000,
  PROBABILITY_OF_SUCCESS: 0.3,
  MARGIN_FRACTION: 0.6,
  TIME_TO_PAYOUT_DAYS: 14,
});

async function corroboratedOpportunity(owner: User, title = "A corroborated opportunity") {
  // The autonomous spend ceiling must exceed the contract's `requiredCapitalUsd`
  // or `decide()` returns HOLD on CAPITAL_EXCEEDS_POLICY — a contract needing
  // more capital than policy allows can be HELD or KILLED and never SCALED.
  // That is the designed behaviour, and it is how this fixture's first version
  // was caught returning HOLD everywhere.
  await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
  const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn net profit" } });
  const opportunity = await db.opportunity.create({
    data: { userId: owner.id, objectiveId: objective.id, title, source: "vox.discovery", status: "ACTIVE" },
  });
  for (const figure of Object.keys(FIGURES) as EconomicFigure[]) {
    const result = await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure,
      value: FIGURES[figure],
      basis: "STATED",
      provenance: `I stand behind the ${figure} myself.`,
    });
    if (!result.recorded) throw new Error(`fixture failed: ${result.reason}`);
  }
  return opportunity;
}

/**
 * An experiment with a COMPLETE, coherent decision contract.
 *
 * `toDecisionContract()` refuses an incomplete one, so every field it reads has
 * to be set — which is the point: a decision over a blank constraint is a
 * decision over a default nobody chose.
 */
async function contractedExperiment(
  owner: User,
  opportunityId: string,
  over: {
    maxLossUsd?: number;
    killAtNetUsd?: number;
    scaleAtNetUsd?: number;
    requiredCapitalUsd?: number;
  } = {}
) {
  const asset = await db.economicAsset.create({
    data: { userId: owner.id, name: "Test asset", category: "OTHER" },
  });
  return db.experiment.create({
    data: {
      userId: owner.id,
      opportunityId,
      economicAssetId: asset.id,
      hypothesis: "A bounded test of the thesis",
      requiredCapitalUsd: over.requiredCapitalUsd ?? 100,
      maxLossUsd: over.maxLossUsd ?? 100,
      killAtNetUsd: over.killAtNetUsd ?? -50,
      scaleAtNetUsd: over.scaleAtNetUsd ?? 50,
      deadlineAt: new Date(Date.now() + 30 * 86_400_000),
      successMetric: "net profit",
      failureMetric: "net loss",
      scaleCriteria: "net above the scale threshold",
      killCriteria: "net at or below the kill threshold",
      // `validateContract()` requires all of these. A fixture missing any one
      // is refused CONTRACT_NOT_EXECUTABLE — which is the designed behaviour
      // and was how this fixture's first version was caught.
      expectedReturnUsd: 300,
      expectedNetProfitUsd: 200,
      requiredCapabilities: JSON.stringify(["none"]),
    },
  });
}

/** Puts real money on the experiment's own ledger. */
async function ledger(assetId: string, revenueUsd: number, expenseUsd: number) {
  if (revenueUsd > 0) {
    await db.economicRevenue.create({
      data: {
        assetId,
        amountUsd: revenueUsd,
        amountCents: Math.round(revenueUsd * 100),
        provenance: "USER_RECORDED",
        occurredAt: new Date(),
      },
    });
  }
  if (expenseUsd > 0) {
    await db.economicExpense.create({
      data: {
        assetId,
        amountUsd: expenseUsd,
        amountCents: Math.round(expenseUsd * 100),
        provenance: "USER_RECORDED",
        occurredAt: new Date(),
      },
    });
  }
}

/** The P6-D chain, run to a reconciled verdict. */
async function reconciledExperiment(
  owner: User,
  opportunityId: string,
  options: { amountMinor?: number; spentMinor?: number; verdict?: "WIN" | "LOSS" | "INCONCLUSIVE" } = {}
) {
  const experiment = await contractedExperiment(owner, opportunityId);
  const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
  if (!predicted.predicted) throw new Error(`fixture prediction failed: ${predicted.reason}`);

  const outcome = await recordOperatorOutcome({
    userId: owner.id,
    experimentId: experiment.id,
    observedValue: 4,
    observedTotal: 4,
    unit: "orders",
    amountMinor: options.amountMinor ?? 20_000,
    amountScale: 2,
    currency: "USD",
    spentMinor: options.spentMinor ?? 1_000,
    provenance: "Counted by hand in the store's order list.",
  });
  if (!outcome.recorded) throw new Error(`fixture outcome failed: ${outcome.reason} ${outcome.detail}`);

  const verdict = await reconcileExperimentOutcome({
    userId: owner.id,
    experimentId: experiment.id,
    verdict: options.verdict ?? "WIN",
  });
  if (!verdict.reconciled) throw new Error(`fixture verdict failed: ${verdict.reason}`);

  return { experiment, prediction: predicted.prediction, outcome };
}

// ---------------------------------------------------------------------------
// 1. The decision is reachable, and reads the same ledger as the tick
// ---------------------------------------------------------------------------

describe("the decision is reachable from outside the scheduler", () => {
  it("ANSWERS SCALE, HOLD OR KILL ON DEMAND", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    // $200 revenue less $10 spend = $190 net, above the $50 scale threshold.
    expect(state.view.actual.netUsd).toBeCloseTo(190, 2);
    expect(state.view.result.decision).toBe("SCALE");
    expect(state.view.result.bindingConstraint).toBeTruthy();
    expect(state.view.evidence).toBe("ACCEPTED");
    expect(state.view.humanVerdict).toBe("WIN");
  });

  it("READS THE SAME LEDGER DEFINITION THE AUTONOMOUS TICK DOES", async () => {
    // Not a near-copy. `measureExperiment()` is exported from the scheduler and
    // called by both, so the number a maximum-loss constraint is compared
    // against cannot differ between the two callers.
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);
    const row = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });

    const direct = await measureExperiment(row.economicAssetId);
    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.view.actual).toEqual(direct);

    // And the verdict matches `decide()` called by hand on the same inputs.
    const contract = toDecisionContract(row)!;
    const user = await db.user.findUniqueOrThrow({
      where: { id: owner.id },
      select: { maxAutonomousSpendUsd: true },
    });
    const byHand = decide({
      contract,
      actual: direct,
      now: new Date(),
      halted: false,
      // The same ceiling. Passing a different one is how this assertion first
      // disagreed: `decide()` HOLDs on CAPITAL_EXCEEDS_POLICY below it.
      policyCeilingUsd: user.maxAutonomousSpendUsd,
    });
    expect(state.view.result.decision).toBe(byHand.decision);
    expect(state.view.result.bindingConstraint).toBe(byHand.bindingConstraint);

    const source = readFileSync("src/lib/economic/experimentDecision.ts", "utf8");
    expect(source).toContain('from "@/lib/economic/scheduler"');
    // No second aggregate over the ledger in this module.
    expect(source).not.toContain("economicRevenue.aggregate");
    expect(source).not.toContain("economicExpense.aggregate");
  });

  it("KILLS A LOSER", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    // `validateContract()` rejects an incoherent contract, so the capital at
    // risk has to sit inside the loss cap rather than above it.
    const experiment = await contractedExperiment(owner, opportunity.id, {
      maxLossUsd: 50,
      killAtNetUsd: -40,
      requiredCapitalUsd: 40,
    });
    const row = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    await ledger(row.economicAssetId!, 0, 60);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.view.result.decision).toBe("KILL");
    expect(state.view.result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });

  it("REPORTS AN EMPTY LEDGER AS A REAL ZERO, NOT A GAP", async () => {
    // The distinction P5-E drew for observations and P6-D for settlement: an
    // empty ledger sums to zero and that is a fact, not a missing measurement.
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await contractedExperiment(owner, opportunity.id);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.view.actual).toEqual({ netUsd: 0, revenueUsd: 0, expenseUsd: 0 });
    expect(state.view.caveats.join(" ")).toMatch(/empty ledger is a real zero/i);
    expect(state.view.caveats.join(" ")).toMatch(/not a missing measurement/i);
  });

  it("respects the global halt rather than deciding around it", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);
    await haltEconomicEngine(owner.id, "operator stopped everything");

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    // A halt stops anything NEW. It does not stop a kill, so the decision is
    // still computed — it is the SCALE that a halt blocks.
    expect(state.view.result.decision).not.toBe("SCALE");
  });
});

// ---------------------------------------------------------------------------
// 2. The new invariant: an unaccepted ledger is not accepted evidence
// ---------------------------------------------------------------------------

describe("evidence classification", () => {
  it("CLASSIFIES A MEASUREMENT NOBODY ACCEPTED AS PROVISIONAL", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await contractedExperiment(owner, opportunity.id);
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);
    const outcome = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      observedValue: 4,
      observedTotal: 4,
      unit: "orders",
      amountMinor: 20_000,
      amountScale: 2,
      currency: "USD",
      spentMinor: 1_000,
      provenance: "Counted by hand.",
    });
    expect(outcome.recorded).toBe(true);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    // The arithmetic is sound and the input is unverified.
    expect(state.view.result.decision).toBe("SCALE");
    expect(state.view.evidence).toBe("PROVISIONAL");
    expect(state.view.humanVerdict).toBeNull();
    expect(state.view.caveats.join(" ")).toMatch(/nobody has accepted it/i);
  });

  it("CLASSIFIES A DECISION WITH NO MEASUREMENT AT ALL", async () => {
    // The ledger can be non-empty without any observation of the experiment —
    // a person can log revenue directly. `decide()` still answers, and the
    // answer rests on no observation of this experiment whatsoever.
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await contractedExperiment(owner, opportunity.id);
    const row = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    await ledger(row.economicAssetId!, 500, 0);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.view.result.decision).toBe("SCALE");
    expect(state.view.evidence).toBe("NO_MEASUREMENT");
    expect(state.view.caveats.join(" ")).toMatch(/nothing has observed this experiment/i);
  });

  it("uses the human's verdict column, not the outcome enum", async () => {
    // P5-D's own distinction. An experiment whose `outcome` holds a value
    // because something set it is not an experiment a human judged.
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await contractedExperiment(owner, opportunity.id);
    await db.experiment.update({
      where: { id: experiment.id },
      // The enum set WITHOUT `outcomeRecordedAt` — nobody decided this.
      data: { outcome: "WIN" },
    });

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.view.evidence).not.toBe("ACCEPTED");
    expect(state.view.humanVerdict).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The posture now recommends it — and only on accepted evidence
// ---------------------------------------------------------------------------

describe("DECIDE_EXPERIMENT is reachable in the posture", () => {
  it("WAS A DECLARED ACTION KIND WITH NO PRODUCER, AND NOW HAS ONE", async () => {
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("DECIDE_EXPERIMENT");
    expect(posture.recommendation.experimentId).toBe(experiment.id);
    expect(posture.counts.awaitingDecision).toBe(1);
    // It names the decision and the existing path that performs it.
    expect(posture.recommendation.action).toMatch(/scale experiment/i);
    expect(posture.recommendation.reason).toMatch(/accepted by you as WIN/i);
    expect(posture.recommendation.path).toMatch(/runEconomicTick/);
    // Not denominated in expected profit per day — inventing a figure for a
    // scale/kill decision would be the dishonesty the EV engine refuses.
    expect(posture.recommendation.expectedNetPerDayCents).toBeNull();
  });

  it("DOES NOT RECOMMEND A DECISION ON A PROVISIONAL MEASUREMENT", async () => {
    // Routed to reconciliation instead, which is the honest order: accept the
    // measurement, then decide on it.
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await contractedExperiment(owner, opportunity.id);
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);
    await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      observedValue: 4,
      observedTotal: 4,
      unit: "orders",
      amountMinor: 20_000,
      amountScale: 2,
      currency: "USD",
      spentMinor: 1_000,
      provenance: "Counted by hand.",
    });

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("RECONCILE_EXPERIMENT");
    expect(posture.counts.awaitingDecision).toBe(0);
  });

  it("SKIPS A HOLD RATHER THAN RECOMMENDING ONE", async () => {
    // A reconciled experiment whose net sits between the thresholds has a real
    // decision — HOLD — and recommending "hold" as the next best action would
    // displace work that is actually worth doing.
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    // $10 revenue, $1 spend = $9 net: above the -$50 kill, below the $50 scale.
    const { experiment } = await reconciledExperiment(owner, opportunity.id, {
      amountMinor: 1_000,
      spentMinor: 100,
    });

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available && state.view.result.decision).toBe("HOLD");
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).not.toBe("DECIDE_EXPERIMENT");
  });

  it("skips an experiment whose contract cannot be evaluated", async () => {
    // A blank constraint is not a decision. The posture moves on rather than
    // reporting an action nobody can take.
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);
    await db.experiment.update({ where: { id: experiment.id }, data: { maxLossUsd: null } });

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(false);
    expect(state.available === false && state.reason).toBe("CONTRACT_NOT_EXECUTABLE");
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).not.toBe("DECIDE_EXPERIMENT");
  });

  it("settling what is already running still comes first", async () => {
    // The module's ordering is the strategy: free information before any
    // decision. An experiment awaiting observation outranks a decision.
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    await reconciledExperiment(owner, opportunity.id);

    // A second experiment VOX dispatched and nobody observed.
    const second = await contractedExperiment(owner, opportunity.id);
    const run = await db.agentRun.create({
      data: { userId: owner.id, objective: "run it", status: "COMPLETED" },
    });
    await db.experiment.update({ where: { id: second.id }, data: { executionRunId: run.id } });

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("OBSERVE_EXPERIMENT");
  });
});

// ---------------------------------------------------------------------------
// 4. Asking is not acting
// ---------------------------------------------------------------------------

describe("the decision surface writes nothing", () => {
  it("ASKING FOR A DECISION CHANGES NO STATE", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);

    const before = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    const eventsBefore = await db.event.count({ where: { userId: owner.id } });

    // Asked three times. `decide()` is pure, so the answer is identical and
    // nothing accumulates.
    const a = await experimentDecisionState(owner.id, experiment.id);
    const b = await experimentDecisionState(owner.id, experiment.id);
    const c = await experimentDecisionState(owner.id, experiment.id);
    expect(a.available && b.available && c.available).toBe(true);
    if (!a.available || !c.available) return;
    expect(c.view.result.decision).toBe(a.view.result.decision);
    expect(c.view.result.bindingConstraint).toBe(a.view.result.bindingConstraint);

    const after = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    // The scheduler stays the ONE writer of decision state.
    expect(after.lastDecision).toBe(before.lastDecision);
    expect(after.lastDecisionAt).toEqual(before.lastDecisionAt);
    expect(after.executionStatus).toBe(before.executionStatus);
    expect(after.status).toBe(before.status);
    expect(after.outcome).toBe(before.outcome);
    expect(after.endedAt).toEqual(before.endedAt);
    expect(await db.event.count({ where: { userId: owner.id } })).toBe(eventsBefore);
  });

  it("A SCALE REMAINS A RECOMMENDATION", async () => {
    const owner = await createTestUser();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 100_000 } });
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available && state.view.result.decision).toBe("SCALE");
    await nextBestEconomicAction(owner.id);

    // I7 holds: nothing was allocated, granted, spent or executed.
    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.commercialAction.count({ where: { userId: owner.id } })).toBe(0);
    const row = await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } });
    expect(row.executionStatus).not.toBe("SCALED");
    expect(state.available && state.view.actionPath).toMatch(/ApprovalGrant/);
  });

  it("imports no allocator, grant, executor or decision writer", () => {
    const imports = (readFileSync("src/lib/economic/experimentDecision.ts", "utf8").match(
      /import[\s\S]*?from\s+["'][^"']+["'];/g
    ) ?? []).join("\n");
    for (const forbidden of [
      "grantPermission",
      "createApprovalGrant",
      "approveCapitalAllocation",
      "requestCapital",
      "recordSpend",
      "executeCommercialAction",
      "runEconomicTick",
      "recordExperimentLesson",
      "recordEvent",
    ]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
  });

  it("refuses a terminal experiment rather than re-deciding its history", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);
    await db.experiment.update({ where: { id: experiment.id }, data: { executionStatus: "KILLED" } });

    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(false);
    expect(state.available === false && state.reason).toBe("ALREADY_TERMINAL");
  });

  it("is scoped per user", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const { experiment } = await reconciledExperiment(owner, opportunity.id);
    const other = await createTestUser();

    const state = await experimentDecisionState(other.id, experiment.id);
    expect(state.available).toBe(false);
    expect(state.available === false && state.reason).toBe("NOT_FOUND");
    expect(await comparableCandidates(other.id)).toHaveLength(0);
  });

  it("refuses an experiment with no ledger", async () => {
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    const experiment = await db.experiment.create({
      data: {
        userId: owner.id,
        opportunityId: opportunity.id,
        hypothesis: "No asset",
        requiredCapitalUsd: 100,
        maxLossUsd: 100,
        killAtNetUsd: -50,
        scaleAtNetUsd: 50,
        deadlineAt: new Date(Date.now() + 86_400_000),
      },
    });
    const state = await experimentDecisionState(owner.id, experiment.id);
    expect(state.available).toBe(false);
    expect(state.available === false && state.reason).toBe("NO_LEDGER");
  });
});

// ---------------------------------------------------------------------------
// 5. The learning link, across opportunities
// ---------------------------------------------------------------------------

describe("one experiment's result informing another opportunity", () => {
  it("OFFERS A COMPARABLE ONLY WHERE BOTH HALVES ARE REAL", async () => {
    const owner = await createTestUser();
    const measured = await corroboratedOpportunity(owner, "The one VOX measured");
    await reconciledExperiment(owner, measured.id);

    // A second opportunity whose revenue figure is only a model's proposal.
    const weak = await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: (await db.objective.findFirstOrThrow({ where: { userId: owner.id } })).id,
        title: "A model's idea",
        source: "vox.discovery",
        status: "ACTIVE",
      },
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      value: 90_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const candidates = await comparableCandidates(owner.id);
    const match = candidates.find(
      (c) => c.opportunityId === weak.id && c.figure === "EXPECTED_REVENUE_CENTS"
    );
    expect(match).toBeDefined();
    expect(match!.currentBasis).toBe("MODEL_SUGGESTED");
    expect(match!.sourceOpportunityId).toBe(measured.id);
    expect(match!.sourceVerdict).toBe("WIN");
    expect(match!.sourceMeasurementId).not.toBeNull();
    expect(match!.upgradePath).toMatch(/judgement about the world/i);
  });

  it("APPLIES NOTHING — THE CANDIDATE IS NOT AN UPGRADE", async () => {
    // I19: only explicit corroborating evidence upgrades a figure, and whether
    // two opportunities are comparable is a judgement nobody automated.
    const owner = await createTestUser();
    const measured = await corroboratedOpportunity(owner, "The one VOX measured");
    await reconciledExperiment(owner, measured.id);
    const weak = await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: (await db.objective.findFirstOrThrow({ where: { userId: owner.id } })).id,
        title: "A model's idea",
        source: "vox.discovery",
      },
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      value: 90_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const before = await listEstimates(owner.id, weak.id);
    await comparableCandidates(owner.id);
    await comparableCandidates(owner.id);
    const after = await listEstimates(owner.id, weak.id);

    expect(after.EXPECTED_REVENUE_CENTS!.basis).toBe("MODEL_SUGGESTED");
    expect(after.EXPECTED_REVENUE_CENTS!.updatedAt.getTime()).toBe(
      before.EXPECTED_REVENUE_CENTS!.updatedAt.getTime()
    );
    expect(after.EXPECTED_REVENUE_CENTS!.comparableId).toBeNull();
    // And the weak opportunity is still unfundable.
    const model = await getOpportunityModel(owner.id, weak.id);
    expect(model!.capital.eligible).toBe(false);
  });

  it("OFFERS NOTHING FROM AN UNRECONCILED MEASUREMENT", async () => {
    // A MEASURED figure whose experiment nobody judged is not citable, for the
    // same reason a PROVISIONAL decision is not recommended.
    const owner = await createTestUser();
    const source = await corroboratedOpportunity(owner, "Measured but unjudged");
    const experiment = await contractedExperiment(owner, source.id);
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);
    const outcome = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      observedValue: 4,
      observedTotal: 4,
      unit: "orders",
      amountMinor: 20_000,
      amountScale: 2,
      currency: "USD",
      spentMinor: 1_000,
      provenance: "Counted by hand.",
    });
    expect(outcome.recorded).toBe(true);
    // The figure IS measured...
    expect((await listEstimates(owner.id, source.id)).EXPECTED_REVENUE_CENTS!.basis).toBe("MEASURED");

    const weak = await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: (await db.objective.findFirstOrThrow({ where: { userId: owner.id } })).id,
        title: "A model's idea",
        source: "vox.discovery",
      },
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      value: 90_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    // ...and no candidate is offered, because no human accepted it.
    expect(await comparableCandidates(owner.id)).toHaveLength(0);
  });

  it("OFFERS NOTHING FROM AN UNRECONCILED MEASUREMENT EVEN WHEN ANOTHER IS RECONCILED", async () => {
    // Found by mutation E5: the previous test had NO reconciled experiment at
    // all, so `comparableCandidates()` returned early and passed whether or not
    // the source filter existed. The filter only does work when SOME experiment
    // is reconciled — that is the state where an unjudged measurement could be
    // offered beside a judged one, and the state nobody had tested.
    const owner = await createTestUser();
    const objectiveId = (
      await db.objective.findFirstOrThrow({
        where: { userId: owner.id },
        orderBy: { createdAt: "desc" },
      }).catch(async () => db.objective.create({ data: { userId: owner.id, title: "Earn" } }))
    ).id;

    // A: judged. Its measured revenue IS citable.
    const judged = await corroboratedOpportunity(owner, "Judged");
    await reconciledExperiment(owner, judged.id);

    // B: measured and NOT judged. Its measured revenue must not be citable.
    const unjudged = await corroboratedOpportunity(owner, "Measured but unjudged");
    const experiment = await contractedExperiment(owner, unjudged.id);
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);
    const outcome = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      observedValue: 4,
      observedTotal: 4,
      unit: "orders",
      amountMinor: 77_777,
      amountScale: 2,
      currency: "USD",
      spentMinor: 1_000,
      provenance: "Counted by hand.",
    });
    expect(outcome.recorded).toBe(true);
    expect((await listEstimates(owner.id, unjudged.id)).EXPECTED_REVENUE_CENTS!.basis).toBe("MEASURED");

    // C: the weak target.
    const weak = await db.opportunity.create({
      data: { userId: owner.id, objectiveId, title: "A model's idea", source: "vox.discovery" },
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      value: 90_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const candidates = await comparableCandidates(owner.id);
    const forWeak = candidates.filter((c) => c.opportunityId === weak.id);
    expect(forWeak.length).toBeGreaterThan(0);
    // The judged one is offered; the unjudged one is not, at all.
    expect(forWeak.every((c) => c.sourceOpportunityId === judged.id)).toBe(true);
    expect(candidates.some((c) => c.sourceOpportunityId === unjudged.id)).toBe(false);
  });

  it("never offers a figure to itself, or one that already clears the bar", async () => {
    const owner = await createTestUser();
    const measured = await corroboratedOpportunity(owner, "The one VOX measured");
    await reconciledExperiment(owner, measured.id);

    const candidates = await comparableCandidates(owner.id);
    // The measured opportunity's own figures are STATED or MEASURED, all of
    // which clear the capital minimum, so none is a target.
    expect(candidates.every((c) => c.opportunityId !== c.sourceOpportunityId)).toBe(true);
    expect(candidates.every((c) => c.currentBasis === "MODEL_SUGGESTED")).toBe(true);
  });

  it("A HUMAN CAN ACT ON A CANDIDATE THROUGH THE EXISTING PATH", async () => {
    // The end of the ladder: the candidate is information, `upgradeEstimate()`
    // is the act, and it still demands the comparable id and verifies it.
    const owner = await createTestUser();
    const measured = await corroboratedOpportunity(owner, "The one VOX measured");
    await reconciledExperiment(owner, measured.id);
    const weak = await db.opportunity.create({
      data: {
        userId: owner.id,
        objectiveId: (await db.objective.findFirstOrThrow({ where: { userId: owner.id } })).id,
        title: "A model's idea",
        source: "vox.discovery",
      },
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      value: 90_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const candidate = (await comparableCandidates(owner.id)).find((c) => c.opportunityId === weak.id)!;
    const upgraded = await upgradeEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_REVENUE_CENTS",
      basis: "COMPARABLE",
      provenance: "The same product category, measured on the other opportunity.",
      evidence: { comparableId: candidate.sourceOpportunityId },
    });
    expect(upgraded.upgraded).toBe(true);
    if (!upgraded.upgraded) return;
    expect(upgraded.from).toBe("MODEL_SUGGESTED");
    expect(upgraded.to).toBe("COMPARABLE");
    expect(upgraded.estimate.comparableId).toBe(measured.id);

    // And an invented comparable id is still refused. Recorded first, because
    // `upgradeEstimate()` refuses NOT_RECORDED before it looks at the evidence.
    await recordEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_PROFIT_CENTS",
      value: 40_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });
    const invented = await upgradeEstimate({
      userId: owner.id,
      opportunityId: weak.id,
      figure: "EXPECTED_PROFIT_CENTS",
      basis: "COMPARABLE",
      provenance: "like that other thing",
      evidence: { comparableId: "opportunity-that-does-not-exist" },
    });
    expect(invented.upgraded).toBe(false);
    expect(invented.upgraded === false && invented.reason).toBe("EVIDENCE_NOT_FOUND");
  });

  it("the reconciled verdict also lifts the measured opportunity's OWN probability", async () => {
    // This link already worked (P6-A/P6-B) and is asserted here because P6-E's
    // whole subject is evidence flowing onward: within one opportunity it goes
    // through `getMeasuredProbability()`, across them through a comparable.
    const owner = await createTestUser();
    const opportunity = await corroboratedOpportunity(owner);
    await reconciledExperiment(owner, opportunity.id, { verdict: "WIN" });

    const probability = await getMeasuredProbability({ userId: owner.id, opportunityId: opportunity.id });
    expect(probability.decided).toBe(1);
    expect(probability.probability).toBe(1);
    const model = await getOpportunityModel(owner.id, opportunity.id);
    expect(model!.figures.PROBABILITY_OF_SUCCESS.basis).toBe("MEASURED");
    expect(model!.figures.PROBABILITY_OF_SUCCESS.source).toBe("MEASUREMENT");
    // One verdict is not a success rate, and the evidence is returned whole so
    // a caller cannot render "1 of 1" as "100%" without seeing the 1.
    expect(probability.wins).toBe(1);
    expect(probability.losses).toBe(0);
  });
});
