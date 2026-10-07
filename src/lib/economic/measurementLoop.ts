/**
 * [P6-D] THE FIRST COMPLETE ECONOMIC FEEDBACK LOOP.
 *
 *   discovered -> corroborated -> experiment -> PREDICTION -> observed outcome
 *   -> MEASURED figure -> ledger -> reconciliation -> one calibration point
 *
 * Every link already existed. P6-A ranks, P6-B records provenance per figure,
 * P6-C discovers, P5-D holds the evidence loop, P5-E/F observe externally, and
 * `calibration.ts` freezes a prediction and scores it against the ledger. What
 * did not exist was the join: nothing carried an opportunity from "corroborated"
 * to "a number VOX was wrong or right about", and so `getCalibration()` had
 * reported NO BASIS since the day it was written.
 *
 * This module is the join and deliberately nothing else. It composes existing
 * functions; it declares no new gate, no second lifecycle and no new provenance
 * vocabulary.
 *
 * ---------------------------------------------------------------------------
 * THE ORDERING IS THE WHOLE INVARIANT
 * ---------------------------------------------------------------------------
 *
 * A measurement cannot be recorded for an experiment that has no frozen
 * prediction. That one refusal makes `prediction.createdAt < measurement`
 * STRUCTURAL rather than conventional: the prediction row has to have existed
 * before the measurement call could succeed, and `ProfitPrediction.experimentId`
 * is UNIQUE so there is exactly one and it cannot be swapped. The explicit
 * timestamp comparison is also made, as a second check on the same fact.
 *
 * Without it the whole exercise is theatre. A system that can write the
 * prediction after seeing the result will always appear well calibrated, and
 * "VOX predicted $500 and earned $40" is the only sentence in this repository
 * that can make a forecast worth anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES A FIGURE MEASURED HERE
 * ---------------------------------------------------------------------------
 *
 * An `ExperimentMeasurement` row, and only that. `upgradeEstimate()` demands it
 * and checks it exists and belongs to the user — so the MEASURED basis is
 * reachable from this module only by way of evidence a person or an external
 * provider actually produced. A model's reasoning is not an argument to any
 * function here; there is nowhere to put it.
 *
 * ONE FIGURE IS PROMOTED, not the row. The operator observes an AMOUNT, so
 * `EXPECTED_REVENUE_CENTS` becomes MEASURED and nothing else moves. The
 * probability, the worst case and the capital requirement keep whatever basis
 * they had — a measured revenue says nothing about them, and P6-B exists so
 * that cannot be fudged.
 *
 * ---------------------------------------------------------------------------
 * AND IT MOVES NO MONEY
 * ---------------------------------------------------------------------------
 *
 * It allocates no capital, mints no `ApprovalGrant`, creates no
 * `CommercialAction` and calls no provider. The ledger rows it writes are
 * `USER_RECORDED` — "a human entered it, true as far as VOX knows" — which is
 * the honest provenance for a figure a person read off a dashboard. `REALIZED`
 * stays unreachable (invariant I1), because nothing here confirms anything
 * against an external system of record.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { fromCents } from "@/lib/economic/money";
import { addEconomicExpense, addEconomicRevenue } from "@/lib/economic/service";
import { recordExternalMeasurement } from "@/lib/economic/evidence";
import {
  getCalibration,
  recordPrediction,
  reconcilePrediction,
  type CalibrationReport,
} from "@/lib/economic/calibration";
import { expectedValueOf } from "@/lib/economic/expectedValue";
import { EV_MATERIAL_FIGURES, FIGURE_SPECS } from "@/lib/economic/figures";
import { getOpportunityModel } from "@/lib/economic/opportunityModel";
import { recordEstimate, upgradeEstimate } from "@/lib/economic/provenance";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { EconomicExpense, EconomicRevenue, ExperimentMeasurement, ProfitPrediction } from "@/generated/prisma/client";

/**
 * The currency and scale the ledger is denominated in.
 *
 * USD, scale 2. NOT a default applied to an amount — a gate. A measurement in
 * another currency or at another scale is REFUSED rather than converted,
 * because converting requires an exchange rate and VOX has none. Inventing one
 * would be fabricating the most load-bearing number in the chain.
 */
export const LEDGER_CURRENCY = "USD";
export const LEDGER_SCALE = 2;

/** The one figure an observed monetary outcome establishes. */
export const MEASURED_FIGURE: EconomicFigure = "EXPECTED_REVENUE_CENTS";

// ---------------------------------------------------------------------------
// Where an opportunity is in the loop
// ---------------------------------------------------------------------------

export type LoopStep =
  /** Figures are too weakly evidenced to justify running anything. */
  | "CORROBORATE"
  /** Corroborated, and no experiment has been declared for it. */
  | "DECLARE_EXPERIMENT"
  /** An experiment exists and nobody has recorded what they expect. */
  | "RECORD_PREDICTION"
  /** A prediction is frozen and the outcome has not been observed. */
  | "ENTER_OUTCOME"
  /** Measured, settled and reconciled. The loop is closed. */
  | "COMPLETE";

export interface LoopExperimentState {
  experimentId: string;
  hypothesis: string;
  economicAssetId: string | null;
  prediction: {
    id: string;
    predictedNetCents: number;
    predictedProbability: number;
    predictedBasis: string;
    horizonDays: number;
    createdAt: Date;
    observedNetCents: number | null;
    unresolvedReason: string | null;
  } | null;
  measurement: {
    id: string;
    source: string;
    observedValue: number;
    unit: string;
    amountMinor: number | null;
    amountScale: number | null;
    currency: string | null;
    provenance: string;
    limitations: string | null;
    observedAt: Date;
  } | null;
  /** The ledger rows settled from the measurement, if any. */
  settled: { revenueCents: number | null; expenseCents: number | null };
}

export interface LoopState {
  opportunityId: string;
  title: string;
  source: string | null;
  /** True when every ev-material figure clears the capital minimum. */
  corroborated: boolean;
  blocking: { figure: EconomicFigure; label: string; basis: string; reason: string }[];
  /** The basis each ev-material figure currently holds. */
  figureBases: { figure: EconomicFigure; label: string; basis: string; value: number | null }[];
  experiment: LoopExperimentState | null;
  step: LoopStep;
}

/**
 * Where one opportunity sits in the loop.
 *
 * `corroborated` reuses `capitalBasisGate()`'s verdict through the opportunity
 * model — the SAME gate the portfolio reads. Declaring a bounded experiment
 * commits real money, so there is no reason for it to answer to a weaker bar
 * than funding does, and inventing a second threshold would be the second
 * economic decision path P6-B/P6-C were careful not to create.
 */
export async function loopState(userId: string, opportunityId: string): Promise<LoopState | null> {
  const model = await getOpportunityModel(userId, opportunityId);
  if (!model) return null;

  const experiment = await db.experiment.findFirst({
    where: { userId, opportunityId },
    orderBy: { createdAt: "desc" },
    include: {
      measurement: { include: { revenueEntry: true, expenseEntry: true } },
      profitPrediction: true,
    },
  });

  const experimentState: LoopExperimentState | null = experiment
    ? {
        experimentId: experiment.id,
        hypothesis: experiment.hypothesis,
        economicAssetId: experiment.economicAssetId,
        prediction: experiment.profitPrediction
          ? {
              id: experiment.profitPrediction.id,
              predictedNetCents: experiment.profitPrediction.predictedNetCents,
              predictedProbability: experiment.profitPrediction.predictedProbability,
              predictedBasis: experiment.profitPrediction.predictedBasis,
              horizonDays: experiment.profitPrediction.horizonDays,
              createdAt: experiment.profitPrediction.createdAt,
              observedNetCents: experiment.profitPrediction.observedNetCents,
              unresolvedReason: experiment.profitPrediction.unresolvedReason,
            }
          : null,
        measurement: experiment.measurement
          ? {
              id: experiment.measurement.id,
              source: experiment.measurement.source,
              observedValue: experiment.measurement.observedValue,
              unit: experiment.measurement.unit,
              amountMinor: experiment.measurement.observedAmountMinor,
              amountScale: experiment.measurement.observedAmountScale,
              currency: experiment.measurement.observedCurrency,
              provenance: experiment.measurement.provenance,
              limitations: experiment.measurement.limitations,
              observedAt: experiment.measurement.observedAt,
            }
          : null,
        settled: {
          revenueCents: experiment.measurement?.revenueEntry?.amountCents ?? null,
          expenseCents: experiment.measurement?.expenseEntry?.amountCents ?? null,
        },
      }
    : null;

  return {
    opportunityId: model.opportunityId,
    title: model.title,
    source: model.source,
    corroborated: model.capital.eligible,
    blocking: model.capital.blocking.map((b) => ({
      figure: b.figure,
      label: FIGURE_SPECS[b.figure].label,
      basis: b.basis,
      reason: b.reason,
    })),
    figureBases: EV_MATERIAL_FIGURES.map((figure) => ({
      figure,
      label: FIGURE_SPECS[figure].label,
      basis: model.figures[figure].basis,
      value: model.figures[figure].value,
    })),
    experiment: experimentState,
    step: deriveStep(model.capital.eligible, experimentState),
  };
}

/**
 * Pure, so the surface and the service cannot disagree about what is next.
 *
 * THE ORDER OF THESE CHECKS IS THE WHOLE FUNCTION, and the rule is: never name
 * a step the service would refuse.
 *
 * Once a prediction is frozen the experiment is underway, and corroboration is
 * moot — the figures may since have been weakened, and the useful next step is
 * still to finish measuring what was started. But BEFORE a prediction exists,
 * recording one requires corroboration (`predictExperimentOutcome()` refuses
 * `NOT_CORROBORATED`), so an uncorroborated opportunity must report
 * `CORROBORATE` even when an experiment row already exists. Reporting
 * `RECORD_PREDICTION` there would point the operator at a button that returns
 * a refusal.
 */
export function deriveStep(corroborated: boolean, experiment: LoopExperimentState | null): LoopStep {
  if (experiment?.prediction) {
    return experiment.prediction.observedNetCents !== null ? "COMPLETE" : "ENTER_OUTCOME";
  }
  if (!corroborated) return "CORROBORATE";
  return experiment ? "RECORD_PREDICTION" : "DECLARE_EXPERIMENT";
}

export async function listLoopStates(userId: string, limit = 25): Promise<LoopState[]> {
  const opportunities = await db.opportunity.findMany({
    where: { userId, status: { in: ["IDEA", "EVALUATING", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  const states = await Promise.all(opportunities.map((o) => loopState(userId, o.id)));
  return states.filter((s): s is LoopState => s !== null);
}

// ---------------------------------------------------------------------------
// Step 1: freeze the prediction
// ---------------------------------------------------------------------------

export type PredictRefusal =
  | "NOT_FOUND"
  /** The opportunity's figures do not clear the capital minimum. */
  | "NOT_CORROBORATED"
  /** The expectation cannot be computed, so there is nothing to predict. */
  | "UNRANKABLE"
  /** A prediction already exists. Predictions are not revised. */
  | "ALREADY_PREDICTED"
  | "INVALID_PREDICTION";

export type PredictResult =
  | { predicted: true; prediction: ProfitPrediction; inputs: PredictionInputSnapshot[] }
  | { predicted: false; reason: PredictRefusal; detail: string };

export interface PredictionInputSnapshot {
  figure: EconomicFigure;
  label: string;
  value: number | null;
  basis: string;
  authoritative: boolean;
}

/**
 * Freezes what VOX expects, BEFORE anything is observed.
 *
 * The prediction is computed from the real per-figure model, so its
 * `predictedBasis` is the genuine weakest input and `predictedInputs` is a
 * snapshot of all of them. That snapshot is the thing that will eventually make
 * "VOX's model-suggested PROFIT figures run optimistic while its measured
 * probabilities are close" answerable; `predictedBasis` alone loses which
 * figure was weak.
 *
 * It refuses an uncorroborated opportunity for the same reason the portfolio
 * does: running a bounded experiment commits money.
 */
export async function predictExperimentOutcome(input: {
  userId: string;
  experimentId: string;
}): Promise<PredictResult> {
  const { userId, experimentId } = input;

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    select: { id: true, opportunityId: true },
  });
  if (!experiment) return { predicted: false, reason: "NOT_FOUND", detail: "No such experiment." };
  if (!experiment.opportunityId) {
    return {
      predicted: false,
      reason: "NOT_FOUND",
      detail: "This experiment is not attached to an opportunity, so there are no figures to predict from.",
    };
  }

  const model = await getOpportunityModel(userId, experiment.opportunityId);
  if (!model) return { predicted: false, reason: "NOT_FOUND", detail: "No such opportunity." };

  if (!model.capital.eligible) {
    return {
      predicted: false,
      reason: "NOT_CORROBORATED",
      detail: `Not yet corroborated: ${model.capital.blocking
        .map((b) => `${FIGURE_SPECS[b.figure].label} (${b.basis})`)
        .join(", ")}. Running an experiment commits money, so it answers to the same bar as funding one.`,
    };
  }

  const expectation = expectedValueOf(model);
  if (!expectation.rankable) {
    return {
      predicted: false,
      reason: "UNRANKABLE",
      detail: `Nothing to predict: ${expectation.missing.join(", ")} ${expectation.missing.length === 1 ? "is" : "are"} not established. A prediction with a made-up input is not a prediction.`,
    };
  }

  const inputs: PredictionInputSnapshot[] = EV_MATERIAL_FIGURES.map((figure) => ({
    figure,
    label: FIGURE_SPECS[figure].label,
    value: model.figures[figure].value,
    basis: model.figures[figure].basis,
    authoritative: model.figures[figure].authoritative,
  }));

  const result = await recordPrediction({
    userId,
    opportunityId: experiment.opportunityId,
    experimentId: experiment.id,
    predictedNetCents: expectation.expectedNetCents,
    predictedProbability: expectation.terms.probability,
    // The genuine weakest input, from the gate's own figures — not a label
    // chosen here.
    predictedBasis: expectation.basis,
    horizonDays: expectation.terms.horizonDays,
    predictedInputs: JSON.stringify(inputs),
  });

  if (!result.recorded) {
    return {
      predicted: false,
      reason: result.reason === "ALREADY_PREDICTED" ? "ALREADY_PREDICTED" : "INVALID_PREDICTION",
      detail: result.detail,
    };
  }

  return { predicted: true, prediction: result.prediction, inputs };
}

// ---------------------------------------------------------------------------
// Step 2: the operator's observation, and the rest of the chain
// ---------------------------------------------------------------------------

export type OutcomeRefusal =
  | "EXPERIMENT_NOT_FOUND"
  | "OPPORTUNITY_MISMATCH"
  /** THE ORDERING GUARANTEE: no frozen prediction, so nothing to score. */
  | "NO_PREDICTION"
  /** The prediction was created after the measurement it would be scored by. */
  | "PREDICTION_NOT_EARLIER"
  /** The experiment has no economic asset, so it has no ledger. */
  | "NO_LEDGER"
  /** A measurement already exists. One experiment, one measurement. */
  | "ALREADY_MEASURED"
  /** VOX executed this experiment, so a hand-entered figure would overwrite its own observation. */
  | "EXECUTION_EXISTS"
  | "INVALID_VALUE"
  /** The amount is not in the ledger's currency and scale, and VOX has no rate. */
  | "CURRENCY_NOT_SETTLEABLE"
  | "FIGURE_NOT_RECORDED";

export interface OperatorOutcomeInput {
  userId: string;
  experimentId: string;
  /** How many units the figure was summed over — orders, signups, sales. */
  observedValue: number;
  /** How many were available to sum. Never fewer than `observedValue`. */
  observedTotal: number;
  unit: string;
  /** The observed money, in minor units. ZERO IS A VALID OBSERVATION. */
  amountMinor: number;
  amountScale: number;
  currency: string;
  /** What the operator actually spent, in minor units. Zero writes no row. */
  spentMinor?: number;
  /** Where the operator got the figure. Required. */
  provenance: string;
  /** What it does not establish, in the operator's own words. */
  limitations?: string;
  occurredAt?: Date;
}

export interface OutcomeResult_Recorded {
  recorded: true;
  measurement: ExperimentMeasurement;
  /** The figure promoted to MEASURED, and from what. */
  promoted: { figure: EconomicFigure; from: string; to: "MEASURED"; estimateId: string };
  revenue: EconomicRevenue | null;
  expense: EconomicExpense | null;
  reconciliation:
    | { reconciled: true; predictedNetCents: number; observedNetCents: number; errorCents: number }
    | { reconciled: false; reason: string; detail: string };
  calibration: CalibrationReport;
  /** Stated plainly rather than left for a reader to infer. */
  caveats: string[];
}

export type OutcomeResult =
  | OutcomeResult_Recorded
  | { recorded: false; reason: OutcomeRefusal; detail: string };

/**
 * Records what a person observed, and runs the rest of the chain.
 *
 * ONE CALL, because the steps after the measurement are mechanical and
 * splitting them would leave the system in states that mean nothing: a
 * measurement whose figure was never promoted, or a settled ledger with no
 * reconciliation. Each step is still the EXISTING function —
 * `recordExternalMeasurement()`, `upgradeEstimate()`, `addEconomicRevenue()`,
 * `reconcilePrediction()` — and each of their refusals is surfaced rather than
 * swallowed.
 */
export async function recordOperatorOutcome(input: OperatorOutcomeInput): Promise<OutcomeResult> {
  const { userId, experimentId } = input;

  // ---- 1. THE LEDGER'S CURRENCY IS A GATE, NOT A DEFAULT ---------------
  if (input.currency !== LEDGER_CURRENCY || input.amountScale !== LEDGER_SCALE) {
    return {
      recorded: false,
      reason: "CURRENCY_NOT_SETTLEABLE",
      detail: `The ledger is ${LEDGER_CURRENCY} at scale ${LEDGER_SCALE} and this amount is ${input.currency} at scale ${input.amountScale}. Converting needs an exchange rate, VOX has none, and inventing one would fabricate the most load-bearing number in the chain. Record the amount in ${LEDGER_CURRENCY}.`,
    };
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) {
    return { recorded: false, reason: "INVALID_VALUE", detail: "The observed amount must be whole, non-negative minor units." };
  }
  if (input.spentMinor !== undefined && (!Number.isInteger(input.spentMinor) || input.spentMinor < 0)) {
    return { recorded: false, reason: "INVALID_VALUE", detail: "The spend must be whole, non-negative minor units." };
  }
  if (input.provenance.trim().length === 0) {
    return {
      recorded: false,
      reason: "INVALID_VALUE",
      detail: "Say where the figure came from. A number with no source is a rumour, and this one is about to become MEASURED.",
    };
  }

  // ---- 2. THE EXPERIMENT, ITS OPPORTUNITY AND ITS LEDGER ---------------
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true, profitPrediction: true },
  });
  if (!experiment) {
    return { recorded: false, reason: "EXPERIMENT_NOT_FOUND", detail: "No such experiment." };
  }
  if (!experiment.opportunityId) {
    return {
      recorded: false,
      reason: "OPPORTUNITY_MISMATCH",
      detail: "This experiment is not attached to an opportunity, so there is no figure for the measurement to establish.",
    };
  }
  if (experiment.measurement) {
    return { recorded: false, reason: "ALREADY_MEASURED", detail: "This experiment already has a measurement. One experiment, one measurement." };
  }
  if (experiment.executionRunId !== null) {
    return {
      recorded: false,
      reason: "EXECUTION_EXISTS",
      detail: "VOX executed this experiment itself. A hand-entered figure would stand in for the observation of its own run — observe the execution instead.",
    };
  }
  if (!experiment.economicAssetId) {
    return {
      recorded: false,
      reason: "NO_LEDGER",
      detail: "The experiment has no economic asset, so there is no ledger to settle into and nothing for the prediction to be scored against.",
    };
  }

  // ---- 3. THE ORDERING GUARANTEE ---------------------------------------
  //
  // Refused BEFORE the measurement is written, so a result can never be
  // observed first and explained afterwards. `ProfitPrediction.experimentId` is
  // UNIQUE, so this is the one prediction and it cannot be swapped later.
  const prediction = experiment.profitPrediction;
  if (!prediction) {
    return {
      recorded: false,
      reason: "NO_PREDICTION",
      detail: "Nothing was predicted for this experiment, so there is nothing to be right or wrong about. Record the prediction first — a forecast written after the result is not a forecast.",
    };
  }

  const now = input.occurredAt ?? new Date();
  if (prediction.createdAt.getTime() >= now.getTime()) {
    // Only reachable with an explicit backdated `occurredAt`. Refused rather
    // than clamped: a measurement timestamped at or before its own prediction
    // destroys the only ordering the calibration rests on.
    return {
      recorded: false,
      reason: "PREDICTION_NOT_EARLIER",
      detail: `The prediction was frozen at ${prediction.createdAt.toISOString()} and this measurement is dated ${now.toISOString()}. A measurement must come after the prediction it scores.`,
    };
  }

  // ---- 4. THE MEASUREMENT, through P5-D's own human-entered path --------
  const measured = await recordExternalMeasurement({
    userId,
    experimentId,
    observedValue: input.observedValue,
    observedTotal: input.observedTotal,
    unit: input.unit,
    provenance: input.provenance,
    money: { amountMinor: input.amountMinor, amountScale: input.amountScale, currency: input.currency },
    limitations: input.limitations,
  });
  if (!measured.recorded) {
    return {
      recorded: false,
      reason:
        measured.reason === "ALREADY_MEASURED"
          ? "ALREADY_MEASURED"
          : measured.reason === "EXECUTION_EXISTS"
            ? "EXECUTION_EXISTS"
            : measured.reason === "NOT_FOUND"
              ? "EXPERIMENT_NOT_FOUND"
              : "INVALID_VALUE",
      detail: `The measurement was refused: ${measured.reason}.`,
    };
  }
  const measurement = measured.measurement;

  // ---- 5. ONE FIGURE BECOMES MEASURED ----------------------------------
  //
  // The amount observed over the window IS the revenue figure, so its value is
  // set to the measured amount. This is CONSERVATIVE where the window is
  // shorter than the figure's horizon: the measured amount is what arrived in
  // the window, which can only be less than or equal to what the full horizon
  // would produce. Understating is the safe direction, and the caveat is stated
  // in the result rather than left implicit.
  const promotion = await promoteMeasuredFigure({
    userId,
    opportunityId: experiment.opportunityId,
    measurement,
    amountCents: input.amountMinor,
  });
  if (!promotion.promoted) {
    return { recorded: false, reason: "FIGURE_NOT_RECORDED", detail: promotion.detail };
  }

  // ---- 6. SETTLE TO THE LEDGER ------------------------------------------
  //
  // A ZERO AMOUNT WRITES NO ROW, and that is correct rather than a shortcut:
  // `toCents()` refuses zero because a zero entry is not a transaction, and the
  // ledger summing to zero IS the real outcome. OBSERVED ZERO and NO LEDGER
  // stay distinct — the asset exists, the sum is zero, and `reconcilePrediction()`
  // reads exactly that.
  const revenue =
    input.amountMinor > 0
      ? await addEconomicRevenue(userId, experiment.economicAssetId, {
          amountUsd: fromCents(input.amountMinor),
          source: `experiment:${experimentId}`,
          occurredAt: now,
          provenance: "USER_RECORDED",
          measurementId: measurement.id,
          notes: `Operator-entered observation. ${input.provenance.trim()}`,
        })
      : null;

  const spent = input.spentMinor ?? 0;
  const expense =
    spent > 0
      ? await addEconomicExpense(userId, experiment.economicAssetId, {
          amountUsd: fromCents(spent),
          category: "experiment",
          occurredAt: now,
          provenance: "USER_RECORDED",
          measurementId: measurement.id,
          notes: `Operator-entered spend for experiment ${experimentId}.`,
        })
      : null;

  // ---- 7. RECONCILE, through the existing function ----------------------
  const reconciled = await reconcilePrediction(userId, prediction.id);
  const reconciliation = reconciled.reconciled
    ? {
        reconciled: true as const,
        predictedNetCents: reconciled.predictedNetCents,
        observedNetCents: reconciled.observedNetCents,
        errorCents: reconciled.errorCents,
      }
    : { reconciled: false as const, reason: reconciled.reason, detail: reconciled.detail };

  const calibration = await getCalibration(userId);

  await recordEvent({
    userId,
    type: "economic.measurement_loop.closed",
    subjectType: "Experiment",
    subjectId: experimentId,
    consequential: true,
    payload: {
      measurementId: measurement.id,
      measurementSource: measurement.source,
      promotedFigure: promotion.figure,
      promotedFrom: promotion.from,
      revenueId: revenue?.id ?? null,
      expenseId: expense?.id ?? null,
      predictionId: prediction.id,
      predictedNetCents: prediction.predictedNetCents,
      observedNetCents: reconciled.reconciled ? reconciled.observedNetCents : null,
      reconciled: reconciled.reconciled,
      calibrationSample: calibration.totalResolved,
      note: "A human entered this figure. VOX did not observe it independently, and the ledger rows are USER_RECORDED rather than REALIZED.",
    },
  });

  return {
    recorded: true,
    measurement,
    promoted: promotion,
    revenue,
    expense,
    reconciliation,
    calibration,
    caveats: buildCaveats({
      amountMinor: input.amountMinor,
      sampleSize: calibration.totalResolved,
      limitations: input.limitations,
    }),
  };
}

type Promotion =
  | { promoted: true; figure: EconomicFigure; from: string; to: "MEASURED"; estimateId: string }
  | { promoted: false; detail: string };

/**
 * Promotes exactly one figure to MEASURED, naming the measurement.
 *
 * `upgradeEstimate()` first, because an upgrade is what this usually is and
 * only the upgrade path records a `previousBasis` and emits the
 * `economic.estimate.upgraded` event. When the figure is ALREADY measured — a
 * second experiment on the same opportunity — that is not an upgrade, and the
 * honest operation is to re-record it at the same basis against the NEW
 * measurement. Both paths demand the evidence; neither can reach MEASURED
 * without it.
 */
async function promoteMeasuredFigure(input: {
  userId: string;
  opportunityId: string;
  measurement: ExperimentMeasurement;
  amountCents: number;
}): Promise<Promotion> {
  const { userId, opportunityId, measurement, amountCents } = input;
  const provenance =
    `Observed ${measurement.observedValue} ${measurement.unit} over the measured window; ` +
    `amount entered by the account owner from ${measurement.provenance}. ` +
    `Measurement ${measurement.id}. VOX did not observe this independently.`;

  const upgraded = await upgradeEstimate({
    userId,
    opportunityId,
    figure: MEASURED_FIGURE,
    basis: "MEASURED",
    provenance,
    value: amountCents,
    evidence: { measurementId: measurement.id },
  });
  if (upgraded.upgraded) {
    return {
      promoted: true,
      figure: MEASURED_FIGURE,
      from: upgraded.from,
      to: "MEASURED",
      estimateId: upgraded.estimate.id,
    };
  }
  if (upgraded.reason !== "NOT_AN_UPGRADE" && upgraded.reason !== "NOT_RECORDED") {
    return { promoted: false, detail: upgraded.detail };
  }

  const recorded = await recordEstimate({
    userId,
    opportunityId,
    figure: MEASURED_FIGURE,
    value: amountCents,
    basis: "MEASURED",
    provenance,
    evidence: { measurementId: measurement.id },
  });
  if (!recorded.recorded) return { promoted: false, detail: recorded.detail };
  return {
    promoted: true,
    figure: MEASURED_FIGURE,
    from: upgraded.reason === "NOT_RECORDED" ? "NONE" : "MEASURED",
    to: "MEASURED",
    estimateId: recorded.estimate.id,
  };
}

/**
 * What this measurement does NOT prove, stated in the result.
 *
 * Returned rather than logged, so a surface has to deal with it. The P5-G
 * posture: the limitations are part of the finding, not a footnote to it.
 */
function buildCaveats(input: { amountMinor: number; sampleSize: number; limitations?: string }): string[] {
  const caveats = [
    "A human entered this figure. VOX did not observe it in an external system of record, so the ledger rows are USER_RECORDED, not REALIZED.",
    "An amount at order time is not revenue: it survives no refund, cancellation or chargeback.",
    "Orders inside a window are not orders the experiment caused. This measures correlation over a declared window, not causation.",
  ];
  if (input.amountMinor === 0) {
    caveats.push("The observed amount is ZERO. That is a real result and the most useful kind for catching an optimistic forecast — it is not a failed measurement.");
  }
  if (input.sampleSize < 5) {
    caveats.push(
      `${input.sampleSize} prediction${input.sampleSize === 1 ? "" : "s"} ${input.sampleSize === 1 ? "has" : "have"} now been scored against the ledger. That is below the minimum for deriving a correction factor, so calibration still reports no basis and every forecast stays unadjusted. One result is not a track record.`
    );
  }
  if (input.limitations?.trim()) caveats.push(`Stated by the operator: ${input.limitations.trim()}`);
  return caveats;
}
