/**
 * [P6-A] PREDICTION VERSUS OUTCOME. THE ONLY HONEST INPUT TO SELF-TRUST.
 *
 * Before this module nothing in VOX recorded a prediction. `Opportunity.probabilityOfSuccess`
 * is a mutable column, so "what did VOX think would happen" was overwritten by
 * "what VOX thinks now" on every edit. A system whose past beliefs are
 * unrecoverable cannot be shown to have been wrong, and a system that cannot be
 * shown to have been wrong cannot improve — it can only accumulate confidence.
 *
 * ---------------------------------------------------------------------------
 * THE TWO HALVES, AND WHY THEY MUST COME FROM DIFFERENT PLACES
 * ---------------------------------------------------------------------------
 *
 * THE PREDICTION is written once, frozen by a digest, from the expected-value
 * engine. It records what was predicted AND the weakest basis it rested on,
 * because the most valuable thing this table can eventually say is not "VOX was
 * wrong" but "VOX's MODEL_SUGGESTED predictions run four times optimistic while
 * its MEASURED ones are close" — and that sentence is impossible without the
 * basis stored beside the number.
 *
 * THE OUTCOME is read from the LEDGER. Never from another estimate, never from
 * the opportunity's own fields, never from a model. `reconcilePrediction()`
 * sums real `EconomicRevenue` and `EconomicExpense` rows, which is the same
 * source `pnl.ts` and `decide()` use, so a prediction is scored against the
 * same reality every other economic decision is made from.
 *
 * If a prediction were allowed to be scored against an estimate, calibration
 * would measure the consistency of VOX's own optimism rather than its accuracy,
 * and would improve as it became more confidently wrong.
 *
 * ---------------------------------------------------------------------------
 * AND IT REFUSES TO PRETEND TO KNOW HOW CALIBRATED IT IS
 * ---------------------------------------------------------------------------
 *
 * `getCalibration()` returns `NO_BASIS` below a minimum sample. Three resolved
 * predictions do not establish a correction factor, and a factor derived from
 * three would be applied to every future forecast with the authority of
 * statistics. Same posture as `getMeasuredProbability()` returning null rather
 * than 0 over no trials.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { ESTIMATE_BASES, type EstimateBasis } from "@/lib/economic/estimate";
import type { ProfitPrediction } from "@/generated/prisma/client";

/**
 * The fewest resolved predictions that may produce a correction factor.
 *
 * Five. Low enough to be reachable, high enough that one unusual result cannot
 * define the factor on its own. Stated as a constant so the threshold is
 * reviewable rather than buried in a comparison.
 */
export const MIN_CALIBRATION_SAMPLE = 5;

export function predictionDigest(input: {
  opportunityId: string;
  predictedNetCents: number;
  predictedProbability: number;
  predictedBasis: string;
  horizonDays: number;
}): string {
  const canonical = [
    input.opportunityId,
    String(input.predictedNetCents),
    input.predictedProbability.toFixed(6),
    input.predictedBasis,
    String(input.horizonDays),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export type RecordPredictionRefusal =
  | "OPPORTUNITY_NOT_FOUND"
  /** A prediction already exists for this experiment. Predictions are not revised. */
  | "ALREADY_PREDICTED"
  | "INVALID_PREDICTION";

export type RecordPredictionResult =
  | { recorded: true; prediction: ProfitPrediction }
  | { recorded: false; reason: RecordPredictionRefusal; detail: string };

export interface RecordPredictionInput {
  userId: string;
  opportunityId: string;
  /** The experiment that will test it. Optional, but without it nothing can resolve it. */
  experimentId?: string;
  predictedNetCents: number;
  predictedProbability: number;
  /** The WEAKEST basis among the inputs. See `weakestBasis()`. */
  predictedBasis: EstimateBasis;
  horizonDays: number;
  /**
   * [P6-D] The per-figure snapshot the prediction was computed from, as JSON.
   *
   * `predictedBasis` above is the weakest of them and is the honest one-word
   * label; it loses WHICH figure was weak. Keeping the snapshot is what makes
   * "its model-suggested profit figures run optimistic while its measured
   * probabilities are close" an answerable question later.
   *
   * Written once with the row and never updated — a prediction's inputs are as
   * frozen as its terms.
   */
  predictedInputs?: string;
}

/**
 * Freezes a prediction.
 *
 * REFUSES A SECOND PREDICTION FOR THE SAME EXPERIMENT. That refusal is the
 * point: a prediction that can be revised once the result is in sight is not a
 * prediction, and a calibration computed over revisable predictions would
 * measure nothing. Revising a forecast means recording a NEW prediction against
 * a new experiment, leaving the first one standing to be scored.
 */
export async function recordPrediction(input: RecordPredictionInput): Promise<RecordPredictionResult> {
  const { userId, opportunityId } = input;

  if (!Number.isInteger(input.predictedNetCents)) {
    return { recorded: false, reason: "INVALID_PREDICTION", detail: "The predicted net must be whole cents." };
  }
  if (
    !Number.isFinite(input.predictedProbability) ||
    input.predictedProbability < 0 ||
    input.predictedProbability > 1
  ) {
    return { recorded: false, reason: "INVALID_PREDICTION", detail: "The predicted probability must be between 0 and 1." };
  }
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1) {
    return { recorded: false, reason: "INVALID_PREDICTION", detail: "The horizon must be a whole number of days." };
  }
  // A basis of NONE means the inputs were not known, which means there was
  // nothing to predict from. Recording it would create a prediction whose own
  // label says it rests on nothing.
  if (input.predictedBasis === "NONE") {
    return {
      recorded: false,
      reason: "INVALID_PREDICTION",
      detail: "A prediction cannot rest on no basis at all. Establish at least one input first.",
    };
  }

  const opportunity = await db.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opportunity) {
    return { recorded: false, reason: "OPPORTUNITY_NOT_FOUND", detail: "No such opportunity." };
  }

  const digest = predictionDigest({
    opportunityId,
    predictedNetCents: input.predictedNetCents,
    predictedProbability: input.predictedProbability,
    predictedBasis: input.predictedBasis,
    horizonDays: input.horizonDays,
  });

  let prediction: ProfitPrediction;
  try {
    prediction = await db.profitPrediction.create({
      data: {
        userId,
        opportunityId,
        experimentId: input.experimentId ?? null,
        predictedNetCents: input.predictedNetCents,
        predictedProbability: input.predictedProbability,
        predictedBasis: input.predictedBasis,
        horizonDays: input.horizonDays,
        predictedInputs: input.predictedInputs ?? null,
        digest,
      },
    });
  } catch {
    // The unique constraint on experimentId is the real guard, not the check.
    return {
      recorded: false,
      reason: "ALREADY_PREDICTED",
      detail: "A prediction already exists for this experiment. Predictions are not revised once made.",
    };
  }

  await recordEvent({
    userId,
    type: "economic.prediction.recorded",
    subjectType: "Opportunity",
    subjectId: opportunityId,
    // Consequential: this is the row a later calibration rests on, and an
    // auditor asking "what did VOX actually predict" has to find it here.
    consequential: true,
    payload: {
      predictionId: prediction.id,
      experimentId: input.experimentId ?? null,
      predictedNetCents: input.predictedNetCents,
      predictedProbability: input.predictedProbability,
      predictedBasis: input.predictedBasis,
      horizonDays: input.horizonDays,
      digest,
      note: "An estimate, frozen. It is not revenue and nothing sums it into profit.",
    },
  });

  return { recorded: true, prediction };
}

export type ReconcileRefusal =
  | "NOT_FOUND"
  | "ALREADY_RESOLVED"
  /** No experiment, so there is no ledger to read an outcome from. */
  | "NO_EXPERIMENT"
  /** The experiment has no economic asset, so it has no ledger at all. */
  | "NO_LEDGER";

export type ReconcilePredictionResult =
  | { reconciled: true; observedNetCents: number; predictedNetCents: number; errorCents: number }
  | { reconciled: false; reason: ReconcileRefusal; detail: string };

/**
 * Scores a prediction against the LEDGER.
 *
 * The outcome is `revenue − expenses` in cents over the experiment's own
 * economic asset — the same definition `decide()` uses for `MeasuredPerformance`,
 * so a prediction is scored against the identical reality a scale/kill decision
 * is taken from.
 *
 * A ZERO LEDGER IS A REAL OUTCOME. An experiment that ran and earned nothing
 * observed net zero, and that is a genuine and important data point: it is how
 * an optimistic prediction gets caught. What is NOT an outcome is an experiment
 * with no asset at all — there is no ledger to read, so nothing is written and
 * the reason is recorded instead. Those two must not collapse, for exactly the
 * reason OBSERVED ZERO and UNAVAILABLE must not in P5-E.
 */
export async function reconcilePrediction(userId: string, predictionId: string): Promise<ReconcilePredictionResult> {
  const prediction = await db.profitPrediction.findFirst({
    where: { id: predictionId, userId },
    include: { experiment: { select: { id: true, economicAssetId: true } } },
  });
  if (!prediction) return { reconciled: false, reason: "NOT_FOUND", detail: "No such prediction." };
  if (prediction.observedNetCents !== null) {
    return { reconciled: false, reason: "ALREADY_RESOLVED", detail: "This prediction already has an outcome." };
  }
  if (!prediction.experiment) {
    await db.profitPrediction.update({
      where: { id: prediction.id },
      data: { unresolvedReason: "NO_EXPERIMENT" },
    });
    return {
      reconciled: false,
      reason: "NO_EXPERIMENT",
      detail: "This prediction is not attached to an experiment, so there is no ledger to score it against.",
    };
  }
  if (!prediction.experiment.economicAssetId) {
    await db.profitPrediction.update({
      where: { id: prediction.id },
      data: { unresolvedReason: "NO_LEDGER" },
    });
    return {
      reconciled: false,
      reason: "NO_LEDGER",
      detail: "The experiment has no economic asset, so it has no revenue or expense rows to measure.",
    };
  }

  const assetId = prediction.experiment.economicAssetId;
  const [revenue, expense] = await Promise.all([
    db.economicRevenue.aggregate({ where: { assetId }, _sum: { amountCents: true } }),
    db.economicExpense.aggregate({ where: { assetId }, _sum: { amountCents: true } }),
  ]);

  // `?? 0` is correct HERE and nowhere else in this file: an aggregate over a
  // ledger with no matching rows genuinely is zero recorded cents. The thing
  // that was guarded above is the different question of whether a ledger exists
  // to sum at all.
  const observedNetCents = (revenue._sum.amountCents ?? 0) - (expense._sum.amountCents ?? 0);

  await db.profitPrediction.update({
    where: { id: prediction.id },
    data: {
      observedNetCents,
      observedAt: new Date(),
      outcomeSource: "LEDGER",
      unresolvedReason: null,
    },
  });

  const errorCents = observedNetCents - prediction.predictedNetCents;

  await recordEvent({
    userId,
    type: "economic.prediction.reconciled",
    subjectType: "Opportunity",
    subjectId: prediction.opportunityId,
    consequential: true,
    payload: {
      predictionId: prediction.id,
      predictedNetCents: prediction.predictedNetCents,
      observedNetCents,
      errorCents,
      predictedBasis: prediction.predictedBasis,
      outcomeSource: "LEDGER",
    },
  });

  return { reconciled: true, observedNetCents, predictedNetCents: prediction.predictedNetCents, errorCents };
}

export interface BasisCalibration {
  basis: EstimateBasis;
  /** Resolved predictions on this basis. */
  resolved: number;
  /**
   * Mean of (observed − predicted) in cents. Negative means VOX was OPTIMISTIC.
   *
   * Reported as a mean ERROR rather than a ratio because a ratio is undefined
   * when a prediction was zero and explodes when it was near zero, and both of
   * those happen constantly in early experiments.
   */
  meanErrorCents: number | null;
  /**
   * Mean observed / mean predicted, when the mean prediction is non-zero.
   *
   * A factor BELOW 1 means predictions on this basis run optimistic. Null
   * rather than 1 when it cannot be computed — a correction factor of 1 asserts
   * "perfectly calibrated", which is the opposite of "unknown".
   */
  factor: number | null;
  /** True when `resolved` is below `MIN_CALIBRATION_SAMPLE`. */
  insufficientSample: boolean;
}

export interface CalibrationReport {
  /** Per basis, so "whose forecasts are trustworthy" is answerable by source. */
  byBasis: BasisCalibration[];
  totalResolved: number;
  totalUnresolved: number;
  /**
   * Overall factor, or null.
   *
   * NULL IS THE HONEST ANSWER until enough predictions have resolved, and
   * callers must render it as an absence rather than as 1.0.
   */
  overallFactor: number | null;
  insufficientSample: boolean;
}

/**
 * How well VOX's predictions have actually matched reality.
 *
 * Read-only arithmetic over resolved rows. No model, no smoothing, no prior.
 */
export async function getCalibration(userId: string): Promise<CalibrationReport> {
  const predictions = await db.profitPrediction.findMany({
    where: { userId },
    select: { predictedNetCents: true, predictedBasis: true, observedNetCents: true },
  });

  const resolved = predictions.filter(
    (p): p is typeof p & { observedNetCents: number } => p.observedNetCents !== null
  );

  const byBasis: BasisCalibration[] = ESTIMATE_BASES.filter((b) => b !== "NONE").map((basis) => {
    const rows = resolved.filter((p) => p.predictedBasis === basis);
    if (rows.length === 0) {
      return { basis, resolved: 0, meanErrorCents: null, factor: null, insufficientSample: true };
    }
    const meanPredicted = rows.reduce((s, r) => s + r.predictedNetCents, 0) / rows.length;
    const meanObserved = rows.reduce((s, r) => s + r.observedNetCents, 0) / rows.length;
    return {
      basis,
      resolved: rows.length,
      meanErrorCents: Math.round(meanObserved - meanPredicted),
      factor: meanPredicted === 0 ? null : meanObserved / meanPredicted,
      insufficientSample: rows.length < MIN_CALIBRATION_SAMPLE,
    };
  });

  const meanPredicted =
    resolved.length === 0 ? 0 : resolved.reduce((s, r) => s + r.predictedNetCents, 0) / resolved.length;
  const meanObserved =
    resolved.length === 0 ? 0 : resolved.reduce((s, r) => s + r.observedNetCents, 0) / resolved.length;

  const insufficientSample = resolved.length < MIN_CALIBRATION_SAMPLE;

  return {
    byBasis,
    totalResolved: resolved.length,
    totalUnresolved: predictions.length - resolved.length,
    // Withheld below the minimum sample, rather than reported weakly. A factor
    // shown with n=2 would be applied to every forecast as though it meant
    // something.
    overallFactor: insufficientSample || meanPredicted === 0 ? null : meanObserved / meanPredicted,
    insufficientSample,
  };
}

/** Predictions that could be scored now: attached to an experiment, not yet resolved. */
export async function listReconcilablePredictions(userId: string, limit = 25): Promise<ProfitPrediction[]> {
  return db.profitPrediction.findMany({
    where: { userId, observedNetCents: null, experimentId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
