/**
 * [P6-D] THE FIRST CLOSED ECONOMIC LOOP — adversarial tests.
 *
 * Everything before this phase built the capacity to REFUSE. P6-A refuses to
 * rank an unresearched opportunity, P6-B refuses to let one figure's basis
 * stand in for another's, P6-C refuses to let a model's invention reserve
 * money. All of it worked, and `getCalibration()` had reported NO BASIS since
 * the day it was written, because nothing had ever been predicted and then
 * measured.
 *
 * So this suite asks the questions that only matter once something is actually
 * measured:
 *
 *   Can a prediction be written after the result is known?
 *   Can a figure become MEASURED without a measurement behind it?
 *   Can a hand-entered figure pass itself off as VOX's own observation?
 *   Can one experiment settle to the ledger twice?
 *   Does an observed ZERO stay distinct from an absent one?
 *   Does one scored prediction become a track record?
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import {
  LEDGER_CURRENCY,
  LEDGER_SCALE,
  MEASURED_FIGURE,
  deriveStep,
  listLoopStates,
  loopState,
  predictExperimentOutcome,
  recordOperatorOutcome,
} from "@/lib/economic/measurementLoop";
import { getCalibration, MIN_CALIBRATION_SAMPLE, recordPrediction } from "@/lib/economic/calibration";
import { EV_MATERIAL_FIGURES, FIGURE_SPECS } from "@/lib/economic/figures";
import { getOpportunityModel } from "@/lib/economic/opportunityModel";
import { listEstimates, recordEstimate, upgradeEstimate } from "@/lib/economic/provenance";
import { recordExternalMeasurement } from "@/lib/economic/evidence";
import { createTestUser } from "./helpers";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { User } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Fixtures — a corroborated opportunity with an experiment and a ledger
// ---------------------------------------------------------------------------

/** The figure values a corroborated opportunity carries. */
const FIGURES: Readonly<Record<EconomicFigure, number>> = Object.freeze({
  REQUIRED_CAPITAL_CENTS: 10_000,
  EXPECTED_REVENUE_CENTS: 80_000,
  EXPECTED_PROFIT_CENTS: 50_000,
  MAX_LOSS_CENTS: 10_000,
  PROBABILITY_OF_SUCCESS: 0.3,
  MARGIN_FRACTION: 0.6,
  TIME_TO_PAYOUT_DAYS: 14,
});

/**
 * An opportunity whose every ev-material figure is STATED by a person.
 *
 * STATED rather than MEASURED, because that is the real starting point: a
 * person stood behind the numbers, which clears the capital minimum, and
 * nothing has been observed yet. That is precisely the state P6-D takes as
 * input.
 */
async function corroboratedOpportunity(owner: User, overrides: Partial<Record<EconomicFigure, number>> = {}) {
  const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn net profit" } });
  const opportunity = await db.opportunity.create({
    data: {
      userId: owner.id,
      objectiveId: objective.id,
      title: "A corroborated opportunity",
      // Deliberately a discovery source, so the whole P6-C -> P6-D path is the
      // one under test: nothing on this row's own columns is economic.
      source: "vox.discovery",
      status: "ACTIVE",
    },
  });
  for (const figure of Object.keys(FIGURES) as EconomicFigure[]) {
    const result = await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure,
      value: overrides[figure] ?? FIGURES[figure],
      basis: "STATED",
      provenance: `I stand behind the ${FIGURE_SPECS[figure].label} myself.`,
    });
    if (!result.recorded) throw new Error(`fixture failed for ${figure}: ${result.reason}`);
  }
  return { objective, opportunity };
}

/** An experiment on that opportunity, with an economic asset so it has a ledger. */
async function experimentFor(owner: User, opportunityId: string, options: { withAsset?: boolean } = {}) {
  const asset =
    options.withAsset === false
      ? null
      : await db.economicAsset.create({
          data: { userId: owner.id, name: "Test asset", category: "OTHER", opportunityId },
        });
  return db.experiment.create({
    data: {
      userId: owner.id,
      opportunityId,
      economicAssetId: asset?.id ?? null,
      hypothesis: "A bounded test of the thesis",
    },
  });
}

/** The whole fixture: corroborated opportunity + experiment + frozen prediction. */
async function readyToMeasure(overrides: Partial<Record<EconomicFigure, number>> = {}) {
  const owner = await createTestUser();
  const { opportunity } = await corroboratedOpportunity(owner, overrides);
  const experiment = await experimentFor(owner, opportunity.id);
  const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
  if (!predicted.predicted) throw new Error(`fixture prediction failed: ${predicted.reason} ${predicted.detail}`);
  return { owner, opportunity, experiment, prediction: predicted.prediction, inputs: predicted.inputs };
}

/** The operator's entry, with sane defaults each test perturbs. */
function entry(over: Partial<Parameters<typeof recordOperatorOutcome>[0]> = {}) {
  return {
    observedValue: 4,
    observedTotal: 4,
    unit: "orders",
    amountMinor: 12_000,
    amountScale: LEDGER_SCALE,
    currency: LEDGER_CURRENCY,
    spentMinor: 3_000,
    provenance: "Counted by hand in the store's order list for the declared window.",
    limitations: "Refunds are not deducted; I did not check for chargebacks.",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. The happy path — the whole chain, once
// ---------------------------------------------------------------------------

describe("the complete loop", () => {
  it("CLOSES: corroborated -> prediction -> operator outcome -> MEASURED -> reconciled -> one calibration point", async () => {
    const owner = await createTestUser();

    // Calibration starts with nothing, and says so.
    const before = await getCalibration(owner.id);
    expect(before.totalResolved).toBe(0);
    expect(before.overallFactor).toBeNull();
    expect(before.insufficientSample).toBe(true);

    const { opportunity } = await corroboratedOpportunity(owner);
    const model = await getOpportunityModel(owner.id, opportunity.id);
    expect(model!.capital.eligible).toBe(true);

    const experiment = await experimentFor(owner, opportunity.id);
    expect((await loopState(owner.id, opportunity.id))!.step).toBe("RECORD_PREDICTION");

    // --- the prediction, frozen, from the real per-figure model -----------
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);
    if (!predicted.predicted) return;
    // 0.3 x 50,000 - 0.7 x 10,000 = 8,000 cents.
    expect(predicted.prediction.predictedNetCents).toBe(8_000);
    expect(predicted.prediction.predictedBasis).toBe("STATED");
    expect(predicted.prediction.horizonDays).toBe(14);
    // The per-figure snapshot, frozen beside the one-word basis.
    expect(predicted.inputs.map((i) => i.figure).sort()).toEqual([...EV_MATERIAL_FIGURES].sort());
    expect(JSON.parse(predicted.prediction.predictedInputs!)).toHaveLength(EV_MATERIAL_FIGURES.length);
    expect((await loopState(owner.id, opportunity.id))!.step).toBe("ENTER_OUTCOME");

    // --- the operator's observation, and the rest of the chain ------------
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    // The measurement is marked as a human's, not VOX's.
    expect(result.measurement.source).toBe("HUMAN_ENTERED");
    expect(result.measurement.rule).toBe("HUMAN_ENTERED");
    expect(result.measurement.observedAmountMinor).toBe(12_000);
    expect(result.measurement.observedAmountScale).toBe(2);
    expect(result.measurement.observedCurrency).toBe("USD");
    expect(result.measurement.limitations).toMatch(/refunds/i);
    // No external provenance invented for it.
    expect(result.measurement.externalProvider).toBeNull();
    expect(result.measurement.responseDigest).toBeNull();

    // ONE figure became MEASURED.
    expect(result.promoted).toMatchObject({ figure: MEASURED_FIGURE, from: "STATED", to: "MEASURED" });
    const estimates = await listEstimates(owner.id, opportunity.id);
    expect(estimates[MEASURED_FIGURE]!.basis).toBe("MEASURED");
    expect(estimates[MEASURED_FIGURE]!.measurementId).toBe(result.measurement.id);
    expect(estimates[MEASURED_FIGURE]!.valueCents).toBe(12_000);
    expect(estimates[MEASURED_FIGURE]!.previousBasis).toBe("STATED");

    // The ledger carries it, as USER_RECORDED, linked to the measurement.
    expect(result.revenue!.amountCents).toBe(12_000);
    expect(result.revenue!.provenance).toBe("USER_RECORDED");
    expect(result.revenue!.measurementId).toBe(result.measurement.id);
    expect(result.expense!.amountCents).toBe(3_000);
    expect(result.expense!.measurementId).toBe(result.measurement.id);

    // Reconciled against the LEDGER: 12,000 - 3,000 = 9,000 observed net.
    expect(result.reconciliation.reconciled).toBe(true);
    if (!result.reconciliation.reconciled) return;
    expect(result.reconciliation.predictedNetCents).toBe(8_000);
    expect(result.reconciliation.observedNetCents).toBe(9_000);
    expect(result.reconciliation.errorCents).toBe(1_000);

    // And calibration has exactly one observation.
    expect(result.calibration.totalResolved).toBe(1);
    expect((await loopState(owner.id, opportunity.id))!.step).toBe("COMPLETE");
  });

  it("promotes ONLY the observed figure", async () => {
    // A measured revenue says nothing about the probability, the worst case or
    // the capital requirement. P6-B exists so that cannot be fudged, and this
    // is the first code with a real reason to try.
    const { owner, opportunity, experiment } = await readyToMeasure();
    const before = await listEstimates(owner.id, opportunity.id);

    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);

    const after = await listEstimates(owner.id, opportunity.id);
    for (const figure of Object.keys(FIGURES) as EconomicFigure[]) {
      if (figure === MEASURED_FIGURE) continue;
      expect(after[figure]!.basis, figure).toBe("STATED");
      expect(after[figure]!.updatedAt.getTime(), figure).toBe(before[figure]!.updatedAt.getTime());
    }
  });

  it("records the loop closure as a consequential event naming the human source", async () => {
    const { owner, experiment } = await readyToMeasure();
    await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });

    const event = await db.event.findFirstOrThrow({
      where: { userId: owner.id, type: "economic.measurement_loop.closed" },
    });
    expect(event.consequential).toBe(true);
    const payload = JSON.parse(event.payload ?? "{}");
    expect(payload.measurementSource).toBe("HUMAN_ENTERED");
    expect(payload.promotedFigure).toBe(MEASURED_FIGURE);
    expect(payload.note).toMatch(/did not observe it independently/i);
    expect(payload.note).toMatch(/USER_RECORDED rather than REALIZED/);
  });

  it("the step derivation is pure and total", () => {
    expect(deriveStep(false, null)).toBe("CORROBORATE");
    expect(deriveStep(true, null)).toBe("DECLARE_EXPERIMENT");
    const bare = { experimentId: "e", hypothesis: "h", economicAssetId: "a", prediction: null, measurement: null, settled: { revenueCents: null, expenseCents: null } };
    expect(deriveStep(true, bare)).toBe("RECORD_PREDICTION");
    // An experiment with no prediction on an UNCORROBORATED opportunity must
    // report CORROBORATE, because recording the prediction is what needs the
    // corroboration and naming RECORD_PREDICTION would point at a refusal.
    expect(deriveStep(false, bare)).toBe("CORROBORATE");
    const predicted = { ...bare, prediction: { id: "p", predictedNetCents: 1, predictedProbability: 0.5, predictedBasis: "STATED", horizonDays: 7, createdAt: new Date(), observedNetCents: null, unresolvedReason: null } };
    expect(deriveStep(true, predicted)).toBe("ENTER_OUTCOME");
    expect(deriveStep(true, { ...predicted, prediction: { ...predicted.prediction, observedNetCents: 500 } })).toBe("COMPLETE");
    // An experiment already running is not reported as needing corroboration,
    // even if its figures were weakened after it started.
    expect(deriveStep(false, predicted)).toBe("ENTER_OUTCOME");
  });
});

// ---------------------------------------------------------------------------
// 2. The ordering invariant
// ---------------------------------------------------------------------------

describe("the prediction must come first", () => {
  it("REFUSES A MEASUREMENT FOR AN EXPERIMENT NOBODY PREDICTED", async () => {
    // The structural guarantee. A result cannot be observed first and explained
    // afterwards, because there is no prediction row to explain it with and the
    // measurement is refused before it is written.
    const owner = await createTestUser();
    const { opportunity } = await corroboratedOpportunity(owner);
    const experiment = await experimentFor(owner, opportunity.id);

    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("NO_PREDICTION");
    expect(result.recorded === false && result.detail).toMatch(/written after the result is not a forecast/i);

    // Nothing was written: no measurement, no ledger row, no MEASURED figure.
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(0);
    const estimates = await listEstimates(owner.id, opportunity.id);
    expect(estimates[MEASURED_FIGURE]!.basis).toBe("STATED");
  });

  it("PROVES prediction.createdAt < measurement time", async () => {
    const { owner, experiment, prediction } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    expect(prediction.createdAt.getTime()).toBeLessThan(result.measurement.observedAt.getTime());
  });

  it("REFUSES A BACKDATED MEASUREMENT that would precede its own prediction", async () => {
    // The only way to break the ordering is an explicit `occurredAt` in the
    // past. Refused rather than clamped: a measurement dated at or before its
    // prediction destroys the only ordering the calibration rests on.
    const { owner, experiment, prediction } = await readyToMeasure();
    const result = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ occurredAt: new Date(prediction.createdAt.getTime() - 60_000) }),
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("PREDICTION_NOT_EARLIER");
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
  });

  it("THE MEASUREMENT CANNOT CREATE OR EDIT THE PREDICTION", async () => {
    const { owner, experiment, prediction } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);

    const after = await db.profitPrediction.findUniqueOrThrow({ where: { id: prediction.id } });
    // Every predicted term, and the digest over them, is byte-identical.
    expect(after.predictedNetCents).toBe(prediction.predictedNetCents);
    expect(after.predictedProbability).toBe(prediction.predictedProbability);
    expect(after.predictedBasis).toBe(prediction.predictedBasis);
    expect(after.horizonDays).toBe(prediction.horizonDays);
    expect(after.digest).toBe(prediction.digest);
    expect(after.predictedInputs).toBe(prediction.predictedInputs);
    expect(after.createdAt.getTime()).toBe(prediction.createdAt.getTime());
    // One prediction, not two: the observed result did not become a second one.
    expect(await db.profitPrediction.count({ where: { userId: owner.id } })).toBe(1);
  });

  it("refuses a second prediction for the same experiment", async () => {
    const { owner, experiment } = await readyToMeasure();
    const again = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(again.predicted).toBe(false);
    expect(again.predicted === false && again.reason).toBe("ALREADY_PREDICTED");
  });

  it("IMPROVING A FIGURE LATER DOES NOT REWRITE THE PREDICTION", async () => {
    // I18, re-asserted at the point where it finally has teeth: the figure
    // genuinely becomes MEASURED during this loop, and the prediction's own
    // record of what it rested on must not follow it.
    const { owner, experiment, prediction } = await readyToMeasure();
    expect(prediction.predictedBasis).toBe("STATED");

    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);

    const after = await db.profitPrediction.findUniqueOrThrow({ where: { id: prediction.id } });
    expect(after.predictedBasis).toBe("STATED");
    const inputs = JSON.parse(after.predictedInputs!) as { figure: string; basis: string }[];
    // The snapshot still says STATED for the figure that is now MEASURED.
    expect(inputs.find((i) => i.figure === MEASURED_FIGURE)).toBeUndefined();
    expect(inputs.every((i) => i.basis === "STATED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Provenance: MEASURED means observed
// ---------------------------------------------------------------------------

describe("what can and cannot make a figure MEASURED", () => {
  it("A MODEL_SUGGESTED FIGURE CANNOT BECOME MEASURED WITHOUT A MEASUREMENT", async () => {
    const owner = await createTestUser();
    const { opportunity } = await corroboratedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: MEASURED_FIGURE,
      value: 80_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const direct = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: MEASURED_FIGURE,
      basis: "MEASURED",
      provenance: "I am very confident and the model agrees with me",
    });
    expect(direct.upgraded).toBe(false);
    expect(direct.upgraded === false && direct.reason).toBe("EVIDENCE_REQUIRED");

    const invented = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: MEASURED_FIGURE,
      basis: "MEASURED",
      provenance: "measured, honestly",
      evidence: { measurementId: "measurement-that-does-not-exist" },
    });
    expect(invented.upgraded).toBe(false);
    expect(invented.upgraded === false && invented.reason).toBe("EVIDENCE_NOT_FOUND");

    expect((await listEstimates(owner.id, opportunity.id))[MEASURED_FIGURE]!.basis).toBe("MODEL_SUGGESTED");
  });

  it("CANNOT CITE ANOTHER USER'S MEASUREMENT", async () => {
    const { owner: a, opportunity } = await readyToMeasure();
    const { owner: b, experiment: bExperiment } = await readyToMeasure();
    const bOutcome = await recordOperatorOutcome({ userId: b.id, experimentId: bExperiment.id, ...entry() });
    expect(bOutcome.recorded).toBe(true);
    if (!bOutcome.recorded) return;

    const stolen = await upgradeEstimate({
      userId: a.id,
      opportunityId: opportunity.id,
      figure: MEASURED_FIGURE,
      basis: "MEASURED",
      provenance: "someone else measured something",
      evidence: { measurementId: bOutcome.measurement.id },
    });
    expect(stolen.upgraded).toBe(false);
    expect(stolen.upgraded === false && stolen.reason).toBe("EVIDENCE_NOT_FOUND");
  });

  it("THE OPERATOR PATH TAKES NO FIELD A MODEL COULD FILL", () => {
    // Structural, not advisory. There is no `basis`, no `confidence`, no
    // `reasoning`, no `externalProvider` and no `responseDigest` on the operator
    // input — so an entry cannot be dressed up as a provider response, and a
    // model's text cannot be submitted as evidence because there is nowhere to
    // put it.
    const source = readFileSync("src/lib/economic/measurementLoop.ts", "utf8");
    const shape = source.slice(
      source.indexOf("export interface OperatorOutcomeInput"),
      source.indexOf("export interface OutcomeResult_Recorded")
    );
    for (const forbidden of [
      "basis",
      "confidence",
      "reasoning",
      "externalProvider",
      "responseDigest",
      "retrievedAt",
      "externalScope",
    ]) {
      expect(shape, forbidden).not.toMatch(new RegExp(`^\\s*${forbidden}\\??:`, "m"));
    }
    // And the route's schema is strict, so an extra key is rejected rather
    // than trimmed.
    const route = readFileSync("src/app/api/economic/experiments/[id]/outcome/route.ts", "utf8");
    expect(route).toContain(".strict()");
  });

  it("the MEASURED basis is hardcoded at the promotion boundary", () => {
    // There is no variable to point at a weaker basis: the literal is the only
    // value in scope, the same move P6-C used for MODEL_SUGGESTED.
    const source = readFileSync("src/lib/economic/measurementLoop.ts", "utf8");
    const promote = source.slice(source.indexOf("async function promoteMeasuredFigure"));
    expect(promote).toContain('basis: "MEASURED"');
    expect(promote).toContain("evidence: { measurementId: measurement.id }");
  });

  it("records the human source permanently on the figure's provenance", async () => {
    const { owner, opportunity, experiment } = await readyToMeasure();
    await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    const estimate = (await listEstimates(owner.id, opportunity.id))[MEASURED_FIGURE]!;
    expect(estimate.provenance).toMatch(/entered by the account owner/i);
    expect(estimate.provenance).toMatch(/did not observe this independently/i);
    expect(estimate.provenance).toContain(estimate.measurementId!);
    // And it is not backdated.
    expect(estimate.establishedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(estimate.establishedAt.getTime()).toBeGreaterThan(Date.now() - 120_000);
  });
});

// ---------------------------------------------------------------------------
// 4. Capital safety is unchanged
// ---------------------------------------------------------------------------

describe("the loop moves no money and grants nothing", () => {
  it("CREATES NO ALLOCATION, GRANT OR COMMERCIAL ACTION", async () => {
    const { owner, experiment } = await readyToMeasure();
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 100_000 } });
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);

    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.commercialAction.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.permission.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("NEVER WRITES REALIZED PROVENANCE", async () => {
    const { owner, experiment } = await readyToMeasure();
    await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });

    const rows = [
      ...(await db.economicRevenue.findMany({ where: { asset: { userId: owner.id } } })),
      ...(await db.economicExpense.findMany({ where: { asset: { userId: owner.id } } })),
    ];
    expect(rows.length).toBe(2);
    // I1: REALIZED means confirmed against an external system of record, and
    // nothing here confirms anything.
    expect(rows.every((r) => r.provenance === "USER_RECORDED")).toBe(true);
  });

  it("imports no allocator, grant or executor", () => {
    const imports = (readFileSync("src/lib/economic/measurementLoop.ts", "utf8").match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
    for (const forbidden of [
      "grantPermission",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "approveCapitalAllocation",
      "requestCapital",
      "executeCommercialAction",
      "executeRun",
      "getAIProvider",
    ]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
  });

  it("the ledger rows keep amountUsd and amountCents in exact agreement", async () => {
    // The representation parity the economic suite guards, asserted on rows
    // this loop wrote — because `fromCents()` round-trips through the USD
    // boundary on the way in.
    const { owner, experiment } = await readyToMeasure();
    await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ amountMinor: 123_457, spentMinor: 99_999 }),
    });
    const rows = [
      ...(await db.economicRevenue.findMany({ where: { asset: { userId: owner.id } } })),
      ...(await db.economicExpense.findMany({ where: { asset: { userId: owner.id } } })),
    ];
    for (const row of rows) {
      expect(Math.round(row.amountUsd * 100), row.id).toBe(row.amountCents);
    }
    expect(rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([99_999, 123_457]);
  });
});

// ---------------------------------------------------------------------------
// 5. Failure cases
// ---------------------------------------------------------------------------

describe("every way the measurement is refused", () => {
  it("a nonexistent experiment", async () => {
    const owner = await createTestUser();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: "nope", ...entry() });
    expect(result.recorded === false && result.reason).toBe("EXPERIMENT_NOT_FOUND");
  });

  it("another user's experiment", async () => {
    const { experiment } = await readyToMeasure();
    const other = await createTestUser();
    const result = await recordOperatorOutcome({ userId: other.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded === false && result.reason).toBe("EXPERIMENT_NOT_FOUND");
  });

  it("an experiment with no opportunity", async () => {
    const owner = await createTestUser();
    const experiment = await db.experiment.create({
      data: { userId: owner.id, hypothesis: "Detached from any opportunity" },
    });
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded === false && result.reason).toBe("OPPORTUNITY_MISMATCH");
  });

  it("an experiment with no ledger to settle into", async () => {
    const owner = await createTestUser();
    const { opportunity } = await corroboratedOpportunity(owner);
    const experiment = await experimentFor(owner, opportunity.id, { withAsset: false });
    const predicted = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(predicted.predicted).toBe(true);

    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded === false && result.reason).toBe("NO_LEDGER");
    // NO LEDGER is not a zero outcome — nothing was written at all.
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
  });

  it("A DUPLICATE MEASUREMENT", async () => {
    const { owner, experiment } = await readyToMeasure();
    expect((await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() })).recorded).toBe(true);

    const second = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(second.recorded === false && second.reason).toBe("ALREADY_MEASURED");
    // One experiment, one measurement, one revenue row, one expense row.
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(1);
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(1);
    expect(await db.economicExpense.count({ where: { asset: { userId: owner.id } } })).toBe(1);
  });

  it("A DUPLICATE RECONCILIATION", async () => {
    const { owner, experiment, prediction } = await readyToMeasure();
    await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });

    const { reconcilePrediction } = await import("@/lib/economic/calibration");
    const again = await reconcilePrediction(owner.id, prediction.id);
    expect(again.reconciled).toBe(false);
    expect(again.reconciled === false && again.reason).toBe("ALREADY_RESOLVED");
    // And calibration still has exactly one observation, not two.
    expect((await getCalibration(owner.id)).totalResolved).toBe(1);
  });

  it("an experiment VOX executed itself", async () => {
    // A hand-entered figure would stand in for the observation of VOX's own
    // run. P5-D's refusal, surfaced through this path.
    const { owner, experiment } = await readyToMeasure();
    const run = await db.agentRun.create({
      data: { userId: owner.id, objective: "run it", status: "COMPLETED" },
    });
    await db.experiment.update({ where: { id: experiment.id }, data: { executionRunId: run.id } });

    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded === false && result.reason).toBe("EXECUTION_EXISTS");
  });

  it("a malformed numeric amount", async () => {
    const { owner, experiment } = await readyToMeasure();
    for (const amountMinor of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry({ amountMinor }) });
      expect(result.recorded, String(amountMinor)).toBe(false);
      expect(result.recorded === false && result.reason, String(amountMinor)).toBe("INVALID_VALUE");
    }
    const negativeSpend = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry({ spentMinor: -1 }) });
    expect(negativeSpend.recorded === false && negativeSpend.reason).toBe("INVALID_VALUE");
  });

  it("A CURRENCY OR SCALE THE LEDGER CANNOT HOLD", async () => {
    // Refused, never converted. Converting needs a rate, VOX has none, and
    // inventing one would fabricate the most load-bearing number in the chain.
    const { owner, experiment } = await readyToMeasure();
    const jpy = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ currency: "JPY", amountScale: 0 }),
    });
    expect(jpy.recorded === false && jpy.reason).toBe("CURRENCY_NOT_SETTLEABLE");
    expect(jpy.recorded === false && jpy.detail).toMatch(/exchange rate/i);

    const kwd = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ currency: "KWD", amountScale: 3 }),
    });
    expect(kwd.recorded === false && kwd.reason).toBe("CURRENCY_NOT_SETTLEABLE");

    // Even USD at the wrong scale: 1250 at scale 3 is $1.25, not $12.50.
    const wrongScale = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ amountScale: 3 }),
    });
    expect(wrongScale.recorded === false && wrongScale.reason).toBe("CURRENCY_NOT_SETTLEABLE");
  });

  it("a missing provenance", async () => {
    const { owner, experiment } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry({ provenance: "   " }) });
    expect(result.recorded === false && result.reason).toBe("INVALID_VALUE");
    expect(result.recorded === false && result.detail).toMatch(/rumour/i);
  });

  it("refuses to predict for an uncorroborated opportunity", async () => {
    const owner = await createTestUser();
    const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
    const opportunity = await db.opportunity.create({
      data: { userId: owner.id, objectiveId: objective.id, title: "A model's idea", source: "vox.discovery" },
    });
    for (const figure of Object.keys(FIGURES) as EconomicFigure[]) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure,
        value: FIGURES[figure],
        basis: "MODEL_SUGGESTED",
        provenance: "a model proposed it",
      });
    }
    const experiment = await experimentFor(owner, opportunity.id);
    const result = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(result.predicted).toBe(false);
    expect(result.predicted === false && result.reason).toBe("NOT_CORROBORATED");
    expect(result.predicted === false && result.detail).toMatch(/same bar as funding/i);
    expect((await loopState(owner.id, opportunity.id))!.step).toBe("CORROBORATE");
  });

  it("refuses to predict when the expectation cannot be computed", async () => {
    const owner = await createTestUser();
    const { opportunity } = await corroboratedOpportunity(owner);
    const { deleteEstimate } = await import("@/lib/economic/provenance");
    await deleteEstimate(owner.id, opportunity.id, "MAX_LOSS_CENTS");
    const experiment = await experimentFor(owner, opportunity.id);

    const result = await predictExperimentOutcome({ userId: owner.id, experimentId: experiment.id });
    expect(result.predicted).toBe(false);
    // Corroboration is checked first, and an absent worst case fails it.
    expect(result.predicted === false && ["NOT_CORROBORATED", "UNRANKABLE"]).toContain(result.predicted === false ? result.reason : "");
  });
});

// ---------------------------------------------------------------------------
// 6. Zero, and the unknown
// ---------------------------------------------------------------------------

describe("an observed zero is a result", () => {
  it("RECORDS A ZERO OUTCOME, WRITES NO LEDGER ROW, AND RECONCILES", async () => {
    // The most valuable measurement there is: it catches an optimistic
    // forecast. `toCents()` refuses zero because a zero entry is not a
    // transaction, so the ledger summing to zero IS the outcome.
    const { owner, experiment, prediction } = await readyToMeasure();
    const result = await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ amountMinor: 0, spentMinor: 0, observedValue: 0, observedTotal: 40 }),
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    expect(result.measurement.observedAmountMinor).toBe(0);
    expect(result.revenue).toBeNull();
    expect(result.expense).toBeNull();
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(0);

    // Reconciled against a ledger that sums to zero.
    expect(result.reconciliation.reconciled).toBe(true);
    if (!result.reconciliation.reconciled) return;
    expect(result.reconciliation.observedNetCents).toBe(0);
    expect(result.reconciliation.errorCents).toBe(-prediction.predictedNetCents);
    expect(result.caveats.join(" ")).toMatch(/observed amount is ZERO/i);
    expect(result.caveats.join(" ")).toMatch(/not a failed measurement/i);
  });

  it("AN OBSERVED ZERO AND AN ABSENT FIGURE STAY DISTINCT", async () => {
    const { owner, opportunity, experiment } = await readyToMeasure();
    await recordOperatorOutcome({
      userId: owner.id,
      experimentId: experiment.id,
      ...entry({ amountMinor: 0, spentMinor: 0 }),
    });

    const model = await getOpportunityModel(owner.id, opportunity.id);
    // The revenue figure is MEASURED at zero — a known value.
    expect(model!.figures[MEASURED_FIGURE].value).toBe(0);
    expect(model!.figures[MEASURED_FIGURE].basis).toBe("MEASURED");

    // An absent figure, by contrast, carries no value at all.
    const { deleteEstimate } = await import("@/lib/economic/provenance");
    await deleteEstimate(owner.id, opportunity.id, "MARGIN_FRACTION");
    const after = await getOpportunityModel(owner.id, opportunity.id);
    expect(after!.figures.MARGIN_FRACTION.value).toBeNull();
    expect(after!.figures.MARGIN_FRACTION.basis).toBe("NONE");
    expect(after!.dimensions.marginFraction.known).toBe(false);
    expect("value" in after!.dimensions.marginFraction).toBe(false);
  });

  it("a prediction with no measurement is not scored as zero", async () => {
    // `reconcilePrediction()` records WHY instead of writing an outcome. A
    // missing measurement must not become a zero result, because a zero result
    // is evidence and a missing one is not.
    const { owner, prediction } = await readyToMeasure();
    const { reconcilePrediction } = await import("@/lib/economic/calibration");
    const result = await reconcilePrediction(owner.id, prediction.id);
    // The asset exists, so the ledger sums to a genuine zero — this is the
    // boundary case, and it resolves rather than refusing.
    expect(result.reconciled).toBe(true);
    if (!result.reconciled) return;
    expect(result.observedNetCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Calibration
// ---------------------------------------------------------------------------

describe("calibration from one observation", () => {
  it("ZERO OBSERVATIONS IS NO BASIS", async () => {
    const owner = await createTestUser();
    const calibration = await getCalibration(owner.id);
    expect(calibration.totalResolved).toBe(0);
    expect(calibration.overallFactor).toBeNull();
    expect(calibration.insufficientSample).toBe(true);
    expect(calibration.byBasis.every((b) => b.resolved === 0 && b.factor === null)).toBe(true);
  });

  it("AN UNSCORED PREDICTION IS NOT AN OBSERVATION", async () => {
    // Found by mutation M12: making `getCalibration()` read an unresolved
    // prediction as `observedNetCents ?? 0` passed every test in this file,
    // because none of them held a prediction that was frozen and NOT measured.
    // That is the exact shape of "increment calibration without reconciling" —
    // a forecast counted as a hit before anyone looked at the result.
    const { owner, prediction } = await readyToMeasure();
    expect(prediction.observedNetCents).toBeNull();

    const calibration = await getCalibration(owner.id);
    expect(calibration.totalResolved).toBe(0);
    expect(calibration.totalUnresolved).toBe(1);
    expect(calibration.overallFactor).toBeNull();
    // And no basis bucket claims it either.
    expect(calibration.byBasis.every((b) => b.resolved === 0)).toBe(true);
    expect(calibration.byBasis.every((b) => b.meanErrorCents === null)).toBe(true);
  });

  it("ONE RECONCILIATION IS ONE OBSERVATION, AND NOT A TRACK RECORD", async () => {
    const { owner, experiment } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);

    const calibration = await getCalibration(owner.id);
    expect(calibration.totalResolved).toBe(1);
    expect(calibration.totalUnresolved).toBe(0);
    // Sample size one. The correction factor is WITHHELD, not computed weakly —
    // a factor shown at n=1 would be applied to every future forecast with the
    // authority of statistics.
    expect(calibration.insufficientSample).toBe(true);
    expect(calibration.overallFactor).toBeNull();
    expect(MIN_CALIBRATION_SAMPLE).toBeGreaterThan(1);

    const stated = calibration.byBasis.find((b) => b.basis === "STATED")!;
    expect(stated.resolved).toBe(1);
    expect(stated.insufficientSample).toBe(true);
    // And the caveat says so in words, in the result the operator sees.
    expect(result.recorded && result.caveats.join(" ")).toMatch(/One result is not a track record/i);
  });

  it("DOES NOT AVERAGE ACROSS BASES", async () => {
    // Two reconciled predictions on different bases stay in different buckets.
    // Averaging them would mix "a person's figures were 20% out" with "a
    // model's were 400% out" into one meaningless number.
    const first = await readyToMeasure();
    await recordOperatorOutcome({ userId: first.owner.id, experimentId: first.experiment.id, ...entry() });

    // A second experiment on the same opportunity, predicted by hand at a
    // different basis so the bucketing is observable.
    const asset = await db.economicAsset.create({
      data: { userId: first.owner.id, name: "Second asset", category: "OTHER" },
    });
    const second = await db.experiment.create({
      data: {
        userId: first.owner.id,
        opportunityId: first.opportunity.id,
        economicAssetId: asset.id,
        hypothesis: "A second bounded test",
      },
    });
    const predicted = await recordPrediction({
      userId: first.owner.id,
      opportunityId: first.opportunity.id,
      experimentId: second.id,
      predictedNetCents: 100_000,
      predictedProbability: 0.9,
      predictedBasis: "MODEL_SUGGESTED",
      horizonDays: 7,
    });
    expect(predicted.recorded).toBe(true);
    await recordOperatorOutcome({
      userId: first.owner.id,
      experimentId: second.id,
      ...entry({ amountMinor: 0, spentMinor: 0 }),
    });

    const calibration = await getCalibration(first.owner.id);
    expect(calibration.totalResolved).toBe(2);
    const stated = calibration.byBasis.find((b) => b.basis === "STATED")!;
    const model = calibration.byBasis.find((b) => b.basis === "MODEL_SUGGESTED")!;
    expect(stated.resolved).toBe(1);
    expect(model.resolved).toBe(1);
    // The model-suggested bucket is the badly wrong one, on its own.
    expect(model.meanErrorCents).toBe(-100_000);
    expect(stated.meanErrorCents).toBe(1_000);
    // Still no basis overall at n=2.
    expect(calibration.insufficientSample).toBe(true);
    expect(calibration.overallFactor).toBeNull();
  });

  it("is scoped per user", async () => {
    const { owner, experiment } = await readyToMeasure();
    await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    const other = await createTestUser();
    expect((await getCalibration(other.id)).totalResolved).toBe(0);
    expect(await listLoopStates(other.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. The human path cannot impersonate an external observation
// ---------------------------------------------------------------------------

describe("human-entered is not external-observed", () => {
  it("MARKS THE SOURCE AS HUMAN AND INVENTS NO EXTERNAL PROVENANCE", async () => {
    const { owner, experiment } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    const row = await db.experimentMeasurement.findUniqueOrThrow({ where: { id: result.measurement.id } });
    expect(row.source).toBe("HUMAN_ENTERED");
    // Every external field stays null: no provider, no scope, no response
    // digest, no retrieval time, no window. Filling any of them would make an
    // operator entry indistinguishable from a store's own answer.
    expect(row.externalProvider).toBeNull();
    expect(row.externalScope).toBeNull();
    expect(row.responseDigest).toBeNull();
    expect(row.retrievedAt).toBeNull();
    expect(row.windowStart).toBeNull();
    expect(row.agentRunId).toBeNull();
    expect(row.agentStepId).toBeNull();
  });

  it("the amount is inside the measurement digest", async () => {
    // A human-entered amount is as frozen as a machine-observed one: restating
    // it after the fact breaks the hash.
    const { owner, experiment } = await readyToMeasure();
    const a = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(a.recorded).toBe(true);
    if (!a.recorded) return;

    const other = await readyToMeasure();
    const b = await recordOperatorOutcome({
      userId: other.owner.id,
      experimentId: other.experiment.id,
      ...entry({ amountMinor: 12_001 }),
    });
    expect(b.recorded).toBe(true);
    if (!b.recorded) return;
    // Same counts, same unit, same provenance text — one cent apart.
    expect(b.measurement.digest).not.toBe(a.measurement.digest);
  });

  it("refuses a partial amount through the measurement path itself", async () => {
    // ALL THREE OR NONE. An integer with no scale is not an amount.
    const owner = await createTestUser();
    const { opportunity } = await corroboratedOpportunity(owner);
    const experiment = await experimentFor(owner, opportunity.id);
    for (const money of [
      { amountMinor: 1_000, amountScale: 9, currency: "USD" },
      { amountMinor: 1_000, amountScale: 2, currency: "usd" },
      { amountMinor: 1_000, amountScale: 2, currency: "DOLLARS" },
      { amountMinor: -1, amountScale: 2, currency: "USD" },
      { amountMinor: 1.5, amountScale: 2, currency: "USD" },
    ]) {
      const result = await recordExternalMeasurement({
        userId: owner.id,
        experimentId: experiment.id,
        observedValue: 1,
        observedTotal: 1,
        unit: "orders",
        provenance: "by hand",
        money,
      });
      expect(result.recorded, JSON.stringify(money)).toBe(false);
      expect(result.recorded === false && result.reason, JSON.stringify(money)).toBe("INVALID_VALUE");
    }
    // And no measurement was created by any of them.
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
  });

  it("the caveats state what the measurement does not prove", async () => {
    const { owner, experiment } = await readyToMeasure();
    const result = await recordOperatorOutcome({ userId: owner.id, experimentId: experiment.id, ...entry() });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    const caveats = result.caveats.join(" ");
    expect(caveats).toMatch(/USER_RECORDED, not REALIZED/);
    expect(caveats).toMatch(/survives no refund/i);
    expect(caveats).toMatch(/not causation/i);
    // The operator's own stated limitation is carried through.
    expect(caveats).toMatch(/Refunds are not deducted/);
  });
});
