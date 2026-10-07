/**
 * [P6-A] "WHAT IS THE BEST THING VOX CAN DO RIGHT NOW TO INCREASE EXPECTED NET
 * PROFIT?"
 *
 * One function answers it. This is the top of the economic decision stack and
 * it is deliberately thin: it reads the real position, ranks what is known,
 * and names the next action. It does not execute, allocate, approve, or spend.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RECOMMENDS INSTEAD OF ACTING
 * ---------------------------------------------------------------------------
 *
 * Every action it can name already has a built, gated path:
 *
 *   RESEARCH          -> the research tool, through the executor
 *   OBSERVE           -> P5-D/E/F `observeExperimentExecution()`
 *   RECONCILE         -> P5-C `reconcileExperimentOutcome()`, a human's verdict
 *   DECIDE            -> `decide()`, deterministic over measured performance
 *   REQUEST CAPITAL   -> P4-F `requestCapital()` -> ApprovalGrant -> approve
 *   SCORE A FORECAST  -> `reconcilePrediction()`, against the ledger
 *
 * If this module executed any of them it would become a second entry point into
 * each, and a second entry point is where the gates get skipped — not by
 * malice, but because the second path is written by someone who has not read
 * the first one's refusals. So it returns a RECOMMENDATION naming the existing
 * path, and the existing path keeps its gate.
 *
 * That is not timidity about autonomy. The autonomy ladder the user wants
 * (OBSERVE -> RESEARCH -> RECOMMEND -> PREPARE -> APPROVAL -> EXECUTE -> SCALE)
 * is a property of what each path permits, and the way to climb it is to raise
 * a specific path's authority deliberately — not to add a caller that bypasses
 * all of them at once.
 *
 * ---------------------------------------------------------------------------
 * THE ORDERING IS THE STRATEGY
 * ---------------------------------------------------------------------------
 *
 * Actions are considered in a fixed order, and the order encodes what is
 * actually most valuable:
 *
 *   1. SETTLE WHAT IS ALREADY RUNNING. An experiment whose window has closed
 *      and whose result nobody has observed is pure unclaimed information, and
 *      it is free. Starting something new while a finished experiment sits
 *      unmeasured is how a portfolio produces activity instead of evidence.
 *   2. SCORE WHAT WAS PREDICTED. A resolved prediction improves every future
 *      forecast, which compounds.
 *   3. DECIDE WHAT THE EVIDENCE NOW SUPPORTS. Scaling a winner and killing a
 *      loser are both worth more than any new candidate. [P6-E] This step was
 *      documented here from the start and had no implementation: the action
 *      kind existed, `decide()` was reachable only from the autonomous tick,
 *      and the RECONCILED stage was read by nothing.
 *   4. ONLY THEN COMMIT NEW CAPITAL, to the best-ranked eligible opportunity.
 *   5. OTHERWISE BUY INFORMATION — research the unrankable, corroborate the
 *      model-suggested. Cheap, and it is what makes step 4 possible later.
 */

import { db } from "@/lib/db";
import { formatCents } from "@/lib/economic/money";
import { getPolicySpendPosition } from "@/lib/economic/accounting";
import { listOpportunityModels } from "@/lib/economic/opportunityModel";
import { expectedValueOf, opportunityCostPerDayCents } from "@/lib/economic/expectedValue";
import { selectPortfolio, type PortfolioPlan } from "@/lib/economic/portfolio";
import { getCalibration, listReconcilablePredictions, type CalibrationReport } from "@/lib/economic/calibration";
import { deriveEvidenceStage } from "@/lib/economic/evidence";
import { experimentDecisionState } from "@/lib/economic/experimentDecision";
import { FIGURE_SPECS, describeCapitalBlock } from "@/lib/economic/figures";

/**
 * What VOX should do next. A closed set — a recommendation VOX cannot express
 * is a recommendation nobody can act on.
 */
export type EconomicActionKind =
  /** An experiment finished and nobody has read its result. Free information. */
  | "OBSERVE_EXPERIMENT"
  /** A measurement exists and no human has judged it. Only a person can. */
  | "RECONCILE_EXPERIMENT"
  /** A prediction can now be scored against the ledger. Improves every forecast. */
  | "SCORE_PREDICTION"
  /** Evidence supports scaling or killing. `decide()` has the verdict. */
  | "DECIDE_EXPERIMENT"
  /** The best eligible opportunity should be funded, through the normal path. */
  | "REQUEST_CAPITAL"
  /** The numbers exist but rest on a model alone. Corroborate before funding. */
  | "CORROBORATE_OPPORTUNITY"
  /** Nothing can be ranked. Go and establish the missing dimensions. */
  | "RESEARCH_OPPORTUNITY"
  /** Nothing worth doing, and the reason why. */
  | "HOLD";

export interface EconomicRecommendation {
  kind: EconomicActionKind;
  /** What to do, in one sentence a person can act on. */
  action: string;
  /** Why this and not something else. Names the binding consideration. */
  reason: string;
  /** The existing, gated path that performs it. Never a new one. */
  path: string;
  opportunityId: string | null;
  experimentId: string | null;
  predictionId: string | null;
  /**
   * Expected gain per day in cents, when it is a capital decision. Null for
   * information-buying actions — their value is real but not denominated in
   * money, and inventing a figure for it would be the exact dishonesty the
   * expected-value engine refuses elsewhere.
   */
  expectedNetPerDayCents: number | null;
  /** What was given up by choosing this, when comparable alternatives existed. */
  opportunityCostPerDayCents: number | null;
}

export interface EconomicPosture {
  recommendation: EconomicRecommendation;
  /** The full plan, so the recommendation is inspectable rather than asserted. */
  plan: PortfolioPlan;
  /** How well VOX's own forecasts have matched reality. May be NO BASIS. */
  calibration: CalibrationReport;
  position: {
    ceilingCents: number;
    spentCents: number;
    remainingCents: number;
    halted: boolean;
    haltReason: string | null;
  };
  counts: {
    opportunitiesConsidered: number;
    rankable: number;
    unrankable: number;
    activeExperiments: number;
    awaitingObservation: number;
    awaitingReconciliation: number;
    /** [P6-E] Reconciled experiments whose scale/kill decision is available. */
    awaitingDecision: number;
    unresolvedPredictions: number;
  };
}

interface ExperimentStage {
  experimentId: string;
  stage: ReturnType<typeof deriveEvidenceStage>;
  opportunityId: string | null;
}

/**
 * Derives where each dispatched experiment sits, reusing P5-D's own pure
 * `deriveEvidenceStage()` rather than re-deciding what "finished" means.
 */
async function experimentStages(userId: string): Promise<ExperimentStage[]> {
  // [P6-E] WIDENED FROM `executionRunId: { not: null }`.
  //
  // The original filter saw only experiments VOX had DISPATCHED, which was
  // right when every measurement came from an execution. P6-D's operator path
  // produces experiments with no execution at all — a person observed the world
  // and typed what they saw — and those were invisible here, so the posture
  // could not recommend reconciling one and (once P6-E added the branch) could
  // not recommend deciding one either. `deriveEvidenceStage()` has always
  // handled the undispatched case explicitly; nothing was ever passing it one.
  const experiments = await db.experiment.findMany({
    where: {
      userId,
      OR: [
        { executionRunId: { not: null } },
        // Measured or judged without a dispatch — the P6-D path.
        { measurement: { isNot: null } },
        { outcomeRecordedAt: { not: null } },
      ],
    },
    include: { measurement: { select: { id: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  if (experiments.length === 0) return [];

  const runIds = experiments.map((e) => e.executionRunId).filter((id): id is string => id !== null);
  const runs = await db.agentRun.findMany({
    where: { id: { in: runIds }, userId },
    include: { steps: { select: { status: true } } },
  });
  const runById = new Map(runs.map((r) => [r.id, r]));

  return experiments.map((experiment) => {
    const run = experiment.executionRunId ? runById.get(experiment.executionRunId) ?? null : null;
    const runIsLive = run?.status === "RUNNING" || run?.status === "PLANNING" || run?.status === "WAITING";
    return {
      experimentId: experiment.id,
      opportunityId: experiment.opportunityId,
      stage: deriveEvidenceStage({
        outcomeRecordedAt: experiment.outcomeRecordedAt,
        executionRunId: experiment.executionRunId,
        hasMeasurement: experiment.measurement !== null,
        runStatus: run?.status ?? null,
        anyStepInDoubt: run ? !runIsLive && run.steps.some((s) => s.status === "RUNNING") : false,
      }),
    };
  });
}

/**
 * The one question, answered.
 */
export async function nextBestEconomicAction(userId: string): Promise<EconomicPosture> {
  const [position, models, stages, reconcilable, calibration] = await Promise.all([
    getPolicySpendPosition(userId),
    listOpportunityModels(userId),
    experimentStages(userId),
    listReconcilablePredictions(userId),
    getCalibration(userId),
  ]);

  const expectations = models.map(expectedValueOf);
  const activeExperiments = stages.filter((s) => s.stage === "EXECUTING" || s.stage === "AWAITING_AUTHORIZATION").length;

  const plan = selectPortfolio({
    expectations,
    deployableCents: position.remainingCents,
    activeExperiments,
    halted: position.halted,
  });

  const awaitingObservation = stages.filter((s) => s.stage === "AWAITING_OBSERVATION");
  const awaitingReconciliation = stages.filter((s) => s.stage === "MEASUREMENT_RECORDED");
  // [P6-E] `deriveEvidenceStage()` has always terminated at RECONCILED and
  // nothing read it, so a reconciled experiment fell through to "fund something
  // new" — the one point in the chain where VOX had the most evidence it will
  // ever have about a live contract and did nothing with it.
  const reconciled = stages.filter((s) => s.stage === "RECONCILED");

  const counts = {
    opportunitiesConsidered: models.length,
    rankable: plan.selected.length + plan.deferred.length,
    unrankable: plan.unrankable.length,
    activeExperiments,
    awaitingObservation: awaitingObservation.length,
    awaitingReconciliation: awaitingReconciliation.length,
    awaitingDecision: reconciled.length,
    unresolvedPredictions: reconcilable.length,
  };

  const base = { plan, calibration, counts, position: {
    ceilingCents: position.ceilingCents,
    spentCents: position.spentCents,
    remainingCents: position.remainingCents,
    halted: position.halted,
    haltReason: position.haltReason,
  } };

  // ---- 1. SETTLE WHAT IS ALREADY RUNNING --------------------------------
  //
  // First because it is free. The execution is paid for, the result exists, and
  // nobody has read it. Every other action costs money or time.
  if (awaitingObservation.length > 0) {
    const target = awaitingObservation[0];
    return {
      ...base,
      recommendation: {
        kind: "OBSERVE_EXPERIMENT",
        action: `Observe the completed execution for experiment ${target.experimentId}.`,
        reason:
          "An experiment has finished and its result has not been read. The execution is already paid for, so this is the cheapest information available — and starting anything new before claiming it produces activity instead of evidence.",
        path: "observeExperimentExecution() — the P5-D evidence loop",
        opportunityId: target.opportunityId,
        experimentId: target.experimentId,
        predictionId: null,
        expectedNetPerDayCents: null,
        opportunityCostPerDayCents: null,
      },
    };
  }

  // ---- 2. SCORE WHAT WAS PREDICTED --------------------------------------
  if (reconcilable.length > 0) {
    const prediction = reconcilable[0];
    return {
      ...base,
      recommendation: {
        kind: "SCORE_PREDICTION",
        action: `Score prediction ${prediction.id} against the ledger.`,
        reason:
          calibration.insufficientSample
            ? `VOX has resolved ${calibration.totalResolved} prediction${calibration.totalResolved === 1 ? "" : "s"}, too few to know how trustworthy its own forecasts are. Each one resolved improves every future estimate.`
            : "Scoring a prediction keeps the calibration current, which is what every future expected-value figure rests on.",
        path: "reconcilePrediction() — reads revenue and expenses from the ledger, never an estimate",
        opportunityId: prediction.opportunityId,
        experimentId: prediction.experimentId,
        predictionId: prediction.id,
        expectedNetPerDayCents: null,
        opportunityCostPerDayCents: null,
      },
    };
  }

  // ---- 3. A HUMAN'S VERDICT ---------------------------------------------
  //
  // A measurement is not evidence until a person accepts it (P5-D/I10), so this
  // is a recommendation TO THE USER and cannot be anything else.
  if (awaitingReconciliation.length > 0) {
    const target = awaitingReconciliation[0];
    return {
      ...base,
      recommendation: {
        kind: "RECONCILE_EXPERIMENT",
        action: `Record your verdict on experiment ${target.experimentId}.`,
        reason:
          "A measurement exists and nothing counts it yet. Only a person can turn a measurement into evidence, and until that happens it affects no probability and no decision.",
        path: "reconcileExperimentOutcome() — a human verdict, via the reconcile endpoint",
        opportunityId: target.opportunityId,
        experimentId: target.experimentId,
        predictionId: null,
        expectedNetPerDayCents: null,
        opportunityCostPerDayCents: null,
      },
    };
  }

  // ---- 4. DECIDE WHAT THE EVIDENCE NOW SUPPORTS -------------------------
  //
  // [P6-E] The step this module's own header has documented since P6-A and
  // which nothing implemented: `DECIDE_EXPERIMENT` was a declared action kind
  // with no producer, and `decide()` was reachable only from the autonomous
  // tick. Scaling a winner and killing a loser are both worth more than any new
  // candidate, because they act on evidence that already exists rather than
  // buying more.
  //
  // ONLY ON ACCEPTED EVIDENCE. The `RECONCILED` stage already guarantees a
  // human recorded a verdict, and `experimentDecisionState()` re-derives that
  // as `evidence: "ACCEPTED"` from the same column. A PROVISIONAL decision is
  // deliberately not recommended — it is routed to reconciliation by step 3
  // above, which is the honest order.
  for (const target of reconciled) {
    const decision = await experimentDecisionState(userId, target.experimentId);
    // A refusal is skipped rather than reported: an incoherent contract or a
    // terminal experiment is not an action, and the next reconciled experiment
    // may well be one.
    if (!decision.available) continue;
    const { view } = decision;
    if (view.result.decision === "HOLD") continue;

    return {
      ...base,
      recommendation: {
        kind: "DECIDE_EXPERIMENT",
        action:
          view.result.decision === "KILL"
            ? `Kill experiment ${target.experimentId} — ${view.result.bindingConstraint.replace(/_/g, " ").toLowerCase()}.`
            : `Scale experiment ${target.experimentId} — it cleared its own threshold.`,
        reason:
          `${view.result.reasons.find((r) => r.binding)?.detail ?? view.result.bindingConstraint} ` +
          `The measurement behind this was accepted by you${view.humanVerdict ? ` as ${view.humanVerdict}` : ""}, so the decision rests on evidence rather than on arithmetic alone. ` +
          `Acting on evidence that already exists is worth more than buying more of it.`,
        path: view.actionPath,
        opportunityId: view.opportunityId,
        experimentId: target.experimentId,
        predictionId: null,
        // Deliberately null. A scale/kill decision is not denominated in
        // expected profit per day — inventing a figure for it would be exactly
        // the dishonesty the expected-value engine refuses elsewhere.
        expectedNetPerDayCents: null,
        opportunityCostPerDayCents: null,
      },
    };
  }

  // ---- 5. NEW CAPITAL, to the best eligible opportunity ------------------
  if (plan.selected.length > 0) {
    const top = plan.selected[0];
    const rankedOnly = plan.selected.map((s) => s.expectation);
    return {
      ...base,
      recommendation: {
        kind: "REQUEST_CAPITAL",
        action:
          top.proposedCapitalCents > 0
            ? `Request ${formatCents(top.proposedCapitalCents)} for opportunity ${top.expectation.opportunityId}.`
            : `Begin opportunity ${top.expectation.opportunityId} — it needs no capital.`,
        reason: `${top.expectation.summary} ${top.rationale}`,
        path:
          top.proposedCapitalCents > 0
            ? "requestCapital() -> a human's ApprovalGrant -> approveCapitalAllocation(). The governor may still refuse or approve less."
            : "the existing experiment contract and execution path",
        opportunityId: top.expectation.opportunityId,
        experimentId: null,
        predictionId: null,
        expectedNetPerDayCents: top.expectation.expectedNetPerDayCents,
        opportunityCostPerDayCents: opportunityCostPerDayCents(top.expectation, rankedOnly),
      },
    };
  }

  // ---- 6. BUY INFORMATION ------------------------------------------------
  //
  // Corroboration before research: an opportunity with numbers that merely lack
  // a credible source is one step from being fundable, while an unrankable one
  // needs the numbers found from scratch.
  const weakBasis = plan.deferred.find((d) => d.reason === "BASIS_TOO_WEAK");
  if (weakBasis) {
    // [P6-B] NAME THE FIGURE. "Its weakest monetary input is a model's
    // proposal" was true and unactionable; "the worst-case loss rests on a
    // model's proposal" is a task. The figures come from the deferral the
    // portfolio already produced, so the recommendation and the plan cannot
    // disagree about which figure is the problem.
    const blocking = weakBasis.blockingFigures;
    const named =
      blocking.length === 0
        ? "a figure below the capital minimum"
        : blocking.map(describeCapitalBlock).join("; ");
    return {
      ...base,
      recommendation: {
        kind: "CORROBORATE_OPPORTUNITY",
        action:
          blocking.length === 0
            ? `Corroborate the figures on opportunity ${weakBasis.opportunityId}.`
            : `Establish better evidence for the ${blocking.map((b) => FIGURE_SPECS[b.figure].label).join(" and ")} on opportunity ${weakBasis.opportunityId}.`,
        reason: `It ranks well, and it is not fundable because ${named}. A model's unsupported number is worth researching and is not worth funding — a measurement, or a comparable VOX has actually run, or a figure you will stand behind yourself, makes that one figure eligible. The rest of the figures are unaffected: provenance is per figure, so corroborating this one does not lift anything else.`,
        path: "research.run through the executor, then recordEstimate()/upgradeEstimate() for the specific figure",
        opportunityId: weakBasis.opportunityId,
        experimentId: null,
        predictionId: null,
        expectedNetPerDayCents: weakBasis.expectedNetPerDayCents,
        opportunityCostPerDayCents: null,
      },
    };
  }

  if (plan.unrankable.length > 0) {
    const target = plan.unrankable[0];
    return {
      ...base,
      recommendation: {
        kind: "RESEARCH_OPPORTUNITY",
        action: `Establish ${target.missing.join(", ")} for opportunity ${target.opportunityId}.`,
        reason: `${plan.unrankable.length} opportunit${plan.unrankable.length === 1 ? "y" : "ies"} cannot be ranked at all, because ${target.missing.length === 1 ? "one dimension has" : "several dimensions have"} no basis. These are not low-value — nobody knows what they are worth, and some of them will outrank everything currently funded once somebody looks.`,
        path: "research.run through the executor, then record what it establishes on the opportunity",
        opportunityId: target.opportunityId,
        experimentId: null,
        predictionId: null,
        expectedNetPerDayCents: null,
        opportunityCostPerDayCents: null,
      },
    };
  }

  // ---- HOLD, with the binding reason ------------------------------------
  return {
    ...base,
    recommendation: {
      kind: "HOLD",
      action: "Nothing is worth starting right now.",
      reason: holdReason(position.halted, position.haltReason, models.length, plan),
      path: "none",
      opportunityId: null,
      experimentId: null,
      predictionId: null,
      expectedNetPerDayCents: null,
      opportunityCostPerDayCents: null,
    },
  };
}

function holdReason(
  halted: boolean,
  haltReason: string | null,
  considered: number,
  plan: PortfolioPlan
): string {
  if (halted) {
    return `The economic engine is halted${haltReason ? ` — ${haltReason}` : ""}. Nothing new begins while it is.`;
  }
  if (considered === 0) {
    return "There are no opportunities on record to evaluate. Nothing can be ranked, and VOX does not invent candidates to fill the list.";
  }
  const negative = plan.deferred.filter((d) => d.reason === "NEGATIVE_EXPECTATION").length;
  if (negative === plan.deferred.length && negative > 0) {
    return `Every ranked opportunity has a negative expected net — the downside outweighs the upside at the stated probabilities. Declining to act on ${negative} losing bet${negative === 1 ? "" : "s"} is the correct decision, not an absence of one.`;
  }
  if (plan.limits.allocatableCents === 0) {
    return "There is no allocatable capital. The spend ceiling is reached or the position is reserved, so no new commitment can be proposed.";
  }
  if (plan.limits.concurrencySlots === 0) {
    return "Every concurrency slot is in use. More experiments than can be observed and reconciled produces no evidence, so the limit binds before capital does.";
  }
  return "No opportunity currently clears the bar on expectation, basis, capital and concurrency together.";
}
